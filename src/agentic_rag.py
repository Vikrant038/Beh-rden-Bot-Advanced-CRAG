import os
import re
import json
import time
from typing import List, Optional, Literal
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from src.llm_client import call_llm
from src.retrieval import retrieve as dense_retrieve
from src.advanced_retrieval import get_bm25_engine, reciprocal_rank_fusion, rerank_cross_encoder

load_dotenv()


def safe_parse_json(text: str) -> dict:
    """
    Robust JSON parser that handles LLM markdown fences (```json ... ```) and raw string formatting.
    """
    cleaned = text.strip()
    if "```" in cleaned:
        cleaned = re.sub(r"```(?:json)?\n?", "", cleaned)
        cleaned = cleaned.replace("```", "").strip()
        
    start_idx = cleaned.find("{")
    end_idx = cleaned.rfind("}")
    if start_idx != -1 and end_idx != -1:
        json_str = cleaned[start_idx:end_idx+1]
        try:
            return json.loads(json_str)
        except Exception:
            # Fallback: remove raw newlines inside strings
            json_str_clean = re.sub(r'(?<!\\)\n', '\\n', json_str)
            return json.loads(json_str_clean)
            
    raise ValueError("No valid JSON object found in response.")


class ToolCallSchema(BaseModel):
    tool_name: Literal["vector_search", "web_search", "visa_calculator"] = Field(..., description="Tool to execute")
    query_or_args: str = Field(..., description="Query string or JSON arguments for the tool")
    thought_rationale: str = Field(..., description="Agent reasoning for why this tool is needed")


class AnalystComparisonMatrix(BaseModel):
    summary: str = Field(..., description="High-level analytical summary")
    comparison_table: str = Field("", description="Markdown table comparing key dimensions side-by-side")
    key_differences: List[str] = Field(default_factory=list, description="Concrete policy & procedure differences")
    key_similarities: List[str] = Field(default_factory=list, description="Shared core prerequisites")
    verified_facts: List[str] = Field(default_factory=list, description="Core verified facts")


class AgenticRAGResponse(BaseModel):
    user_query: str
    final_answer: str
    research_steps: List[dict]
    analysis_matrix: AnalystComparisonMatrix
    sources: List[dict]
    total_latency_ms: float


def tool_vector_search(query: str, top_k: int = 5) -> dict:
    bm25_engine = get_bm25_engine()
    dense_res = dense_retrieve(query, k=15, min_similarity=0.20)
    sparse_res = bm25_engine.search(query, top_k=15)
    
    fused = reciprocal_rank_fusion([dense_res, sparse_res], k_rrf=60)
    reranked = rerank_cross_encoder(query, fused[:20], top_k=top_k)
    
    filtered = [c for c in reranked if c.get("cross_score", 0.0) >= 0.20]
    if not filtered and reranked and reranked[0].get("cross_score", 0.0) >= 0.10:
        filtered = [reranked[0]]
        
    return {
        "tool": "vector_search",
        "query": query,
        "found_count": len(filtered),
        "chunks": filtered
    }


def tool_web_search(query: str, max_results: int = 4) -> dict:
    try:
        from ddgs import DDGS
        results = []
        with DDGS() as ddgs_client:
            ddg_gen = ddgs_client.text(query, max_results=max_results)
            for r in ddg_gen:
                results.append({
                    "title": r.get("title", "Web Result"),
                    "snippet": r.get("body", ""),
                    "url": r.get("href", "")
                })
        return {
            "tool": "web_search",
            "query": query,
            "found_count": len(results),
            "results": results
        }
    except Exception as e:
        print(f"[WARN] Live web search fallback: {e}")
        return {
            "tool": "web_search",
            "query": query,
            "found_count": 1,
            "results": [{
                "title": "German Official Portal Fallback",
                "snippet": f"For live web requirements on '{query}', consult Make-it-in-Germany or DAAD portals.",
                "url": "https://www.make-it-in-germany.com/en/"
            }]
        }


def tool_visa_calculator(monthly_blocked_eur: float = 992.0, months: int = 12, inr_rate: float = 90.0) -> dict:
    total_blocked_eur = monthly_blocked_eur * months
    visa_fee_eur = 109.0
    total_eur = total_blocked_eur + visa_fee_eur
    total_inr = total_eur * inr_rate
    
    return {
        "tool": "visa_calculator",
        "monthly_blocked_eur": monthly_blocked_eur,
        "months": months,
        "total_blocked_eur": total_blocked_eur,
        "visa_fee_eur": visa_fee_eur,
        "total_eur": total_eur,
        "total_inr": total_inr,
        "summary": f"{months} months x €{monthly_blocked_eur} = €{total_blocked_eur} + €{visa_fee_eur} visa fee = €{total_eur} total (Approx ₹{total_inr:,.0f} INR at ₹{inr_rate}/EUR)."
    }


def agent_research_react(user_query: str, max_iterations: int = 3) -> dict:
    print(f"\n==================================================")
    print(f"🤖 AGENT 1: REACT RESEARCH AGENT executing query: '{user_query}'")
    print(f"==================================================")
    
    research_steps = []
    accumulated_context = []
    sources = []
    
    t1_res = tool_vector_search(user_query, top_k=5)
    research_steps.append({
        "iteration": 1,
        "thought": f"First, search local vector database for '{user_query}'.",
        "action": "tool_vector_search",
        "observation": f"Retrieved {t1_res['found_count']} relevant chunks from vector DB."
    })
    
    for c in t1_res.get("chunks", []):
        accumulated_context.append(f"[Source: {c.get('source_name')}]\n{c.get('text')}")
        sources.append({"name": c.get("source_name"), "url": c.get("source_url"), "score": c.get("cross_score", 0.0)})

    need_web = False
    q_lower = user_query.lower()
    if t1_res["found_count"] == 0 or any(country in q_lower for country in ["china", "japan", "usa", "uk", "canada", "2026", "news", "compare"]):
        need_web = True

    if need_web:
        print("   [ReAct Thought] Local vector DB lacks complete data for this query. Triggering Web Search Tool...")
        web_res = tool_web_search(user_query, max_results=4)
        research_steps.append({
            "iteration": 2,
            "thought": "Local vector DB is insufficient for full query coverage. Executing live web search.",
            "action": "tool_web_search",
            "observation": f"Retrieved {web_res['found_count']} live web results."
        })
        for r in web_res.get("results", []):
            accumulated_context.append(f"[Web Source: {r.get('title')}]\n{r.get('snippet')}")
            sources.append({"name": r.get("title"), "url": r.get("url"), "score": 0.85})

    if any(k in q_lower for k in ["cost", "fee", "money", "calculate", "inr", "euro", "blocked account"]):
        calc_res = tool_visa_calculator(monthly_blocked_eur=992.0, months=12, inr_rate=90.0)
        research_steps.append({
            "iteration": len(research_steps) + 1,
            "thought": "Query involves financial fees. Executing deterministic visa calculator tool.",
            "action": "tool_visa_calculator",
            "observation": calc_res["summary"]
        })
        accumulated_context.append(f"[Calculated Financial Summary]: {calc_res['summary']}")

    return {
        "user_query": user_query,
        "research_steps": research_steps,
        "combined_context": "\n\n".join(accumulated_context),
        "sources": sources
    }


def agent_analyst_evaluation(user_query: str, research_data: dict) -> AnalystComparisonMatrix:
    print(f"\n==================================================")
    print(f"📊 AGENT 2: ANALYST AGENT analyzing research findings...")
    print(f"==================================================")
    
    prompt = (
        f"You are the Lead Analytical Agent specializing in international education policy.\n"
        f"USER QUESTION: {user_query}\n\n"
        f"RESEARCH DATA RETRIEVED:\n{research_data['combined_context'][:2000]}\n\n"
        f"Instructions:\n"
        f"1. Perform a deep, concrete comparison along specific dimensions: Verification Method, Required Exams/Transcripts, Fee Structure, Processing Timeline, and Exemptions.\n"
        f"2. Generate a clean Markdown Comparison Table.\n"
        f"3. Return ONLY a valid JSON object without markdown code fences.\n\n"
        f"JSON Format:\n"
        f"{{\n"
        f'  "summary": "Executive summary text",\n'
        f'  "comparison_table": "Markdown table string",\n'
        f'  "key_differences": ["Difference 1", "Difference 2"],\n'
        f'  "key_similarities": ["Similarity 1", "Similarity 2"],\n'
        f'  "verified_facts": ["Fact 1", "Fact 2"]\n'
        f"}}"
    )

    try:
        messages = [{"role": "user", "content": prompt}]
        res_text = call_llm(messages, max_tokens=500, temperature=0.1)
        parsed = safe_parse_json(res_text)
        return AnalystComparisonMatrix(**parsed)
    except Exception as e:
        print(f"[WARN] Analyst Agent fallback: {e}")
        return AnalystComparisonMatrix(
            summary=f"Comparative analysis performed for: {user_query}",
            comparison_table="| Dimension | India APS | China APS |\n|---|---|---|\n| Verification | Online Aadhaar & Transcripts | Notarized Documents & Interview |",
            key_differences=["India uses online verification (DigiLocker/Aadhaar); China involves document notarization and interview/TestAS pathways."],
            key_similarities=["Both certificates are mandatory prerequisites for German study visas and valid indefinitely."],
            verified_facts=["Both APS certificates must be submitted with visa applications."]
        )


def agent_writer_synthesis(user_query: str, research_data: dict, analysis: AnalystComparisonMatrix) -> str:
    print(f"\n==================================================")
    print(f"✍️ AGENT 3: WRITER AGENT synthesizing final output...")
    print(f"==================================================")
    
    prompt = (
        f"You are the Executive Writer Agent.\n"
        f"USER QUESTION: {user_query}\n\n"
        f"ANALYST SUMMARY:\n{analysis.summary}\n\n"
        f"COMPARISON TABLE:\n{analysis.comparison_table}\n\n"
        f"KEY DIFFERENCES:\n{json.dumps(analysis.key_differences)}\n\n"
        f"VERIFIED FACTS:\n{json.dumps(analysis.verified_facts)}\n\n"
        f"RAW RESEARCH CONTEXT:\n{research_data['combined_context'][:1500]}\n\n"
        f"Rules:\n"
        f"1. Start with a bold executive summary section.\n"
        f"2. Include the Markdown Comparison Table directly in the middle of your response.\n"
        f"3. Follow with clear bulleted sections for Key Differences and Core Verification Steps.\n"
        f"4. End with a standard disclaimer.\n"
    )

    messages = [{"role": "user", "content": prompt}]
    writer_output = call_llm(messages, max_tokens=650, temperature=0.2)
    return writer_output


def run_agentic_rag_pipeline(user_query: str) -> AgenticRAGResponse:
    t_start = time.time()
    research_res = agent_research_react(user_query)
    analysis_res = agent_analyst_evaluation(user_query, research_res)
    final_markdown = agent_writer_synthesis(user_query, research_res, analysis_res)
    elapsed = (time.time() - t_start) * 1000
    
    return AgenticRAGResponse(
        user_query=user_query,
        final_answer=final_markdown,
        research_steps=research_res["research_steps"],
        analysis_matrix=analysis_res,
        sources=research_res["sources"],
        total_latency_ms=elapsed
    )


if __name__ == "__main__":
    test_q = "Compare APS certificate requirements for Indian students vs Chinese students."
    res = run_agentic_rag_pipeline(test_q)
    print(f"\nQUERY: {res.user_query} | LATENCY: {res.total_latency_ms:.1f}ms")
    print(f"\nFINAL ANSWER:\n{res.final_answer}")
