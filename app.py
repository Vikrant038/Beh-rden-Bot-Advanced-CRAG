import os
import time
import streamlit as st
from dotenv import load_dotenv

from src.rag import rag_answer, RAGQueryRequest, RAGResponse
from src.agentic_rag import run_agentic_rag_pipeline, AgenticRAGResponse

load_dotenv()

# ==========================================
# PAGE CONFIGURATION & STYLING
# ==========================================
st.set_page_config(
    page_title="Behoerden-Bot — German Visa & Study Assistant",
    layout="wide",
    initial_sidebar_state="expanded"
)

st.markdown("""
<style>
    .main {
        background-color: #0f172a;
        color: #f8fafc;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    }
    
    .header-container {
        background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%);
        padding: 24px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 24px;
    }
    
    .header-title {
        font-size: 2.2rem;
        font-weight: 800;
        color: #ffffff;
        margin-bottom: 6px;
    }
    
    .header-subtitle {
        color: #cbd5e1;
        font-size: 1.0rem;
    }
</style>
""", unsafe_allow_html=True)


# ==========================================
# INITIALIZE CHAT SESSION STATE
# ==========================================
if "messages" not in st.session_state:
    st.session_state["messages"] = [
        {
            "role": "assistant",
            "content": "Welcome. I am **Behoerden-Bot**, an automated informational assistant specializing in German immigration, student visa requirements, APS certification, blocked accounts, and university admission regulations.\n\nHow may I assist you with your academic plans in Germany?",
            "sources": [],
            "metadata": {}
        }
    ]


# ==========================================
# HEADER SECTION
# ==========================================
st.markdown("""
<div class="header-container">
    <div class="header-title">Behoerden-Bot — German Visa & Study Assistant</div>
    <div class="header-subtitle">Enterprise 3-Agent ReAct RAG Orchestrator | BGE 768d Dense Vectors | BM25 Keyword Search | Cross-Encoder Re-Ranking</div>
</div>
""", unsafe_allow_html=True)


# ==========================================
# SIDEBAR NAVIGATION & MODE SELECTION
# ==========================================
with st.sidebar:
    st.title("Navigation & Settings")
    
    st.markdown("---")
    st.subheader("Engine Mode")
    rag_mode = st.radio(
        "Select Pipeline Mode:",
        ["3-Agent ReAct RAG (Research -> Analyst -> Writer)", "Standard Advanced CRAG RAG"],
        index=0
    )
    
    st.markdown("---")
    st.subheader("Sample Queries")
    
    sample_queries = [
        "Compare APS certificate requirements for Indian students vs Chinese students.",
        "What documents are required for a German student visa application from India?",
        "How does a blocked account (Sperrkonto) work and calculate 12 months cost at 90 INR/EUR?",
        "What health insurance is required for international students in Germany?",
        "How do I register my housing address (Anmeldung) after arriving in Germany?"
    ]
    
    selected_sample = None
    for q in sample_queries:
        if st.button(q, key=f"sample_{q[:20]}"):
            selected_sample = q

    st.markdown("---")
    st.subheader("Multi-Agent Architecture")
    st.markdown("""
    - **Agent 1 (Research):** ReAct Iterative Tool Calling (FAISS + Web + Calculator)
    - **Agent 2 (Analyst):** Comparative Matrix Extractor
    - **Agent 3 (Writer):** Executive Synthesis & Formatting
    """)
    
    st.markdown("---")
    st.caption("Disclaimer: General information only. Verify critical decisions with official German Embassy, DAAD, or BAMF portals.")


# ==========================================
# RENDER CHAT HISTORY
# ==========================================
selected_option_click = None

for idx, msg in enumerate(st.session_state["messages"]):
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])
        
        # Collapsed by default for clean UX
        if msg.get("research_steps"):
            with st.expander("Developer Debug: ReAct Execution Steps", expanded=False):
                for step in msg["research_steps"]:
                    st.markdown(f"**Iteration {step['iteration']}** ({step['action']})")
                    st.markdown(f"- *Thought:* {step['thought']}")
                    st.markdown(f"- *Observation:* {step['observation']}")

        if msg.get("sources"):
            with st.expander("Verified Official Sources Used", expanded=False):
                for s in msg["sources"]:
                    st.markdown(f"- [{s['name']}]({s['url']}) (Relevance Score: {s.get('score', 0):.4f})")
                    
        meta = msg.get("metadata", {})
        if meta:
            col1, col2 = st.columns(2)
            with col1:
                st.caption(f"Engine Path: `{meta.get('path', 'N/A')}`")
            with col2:
                st.caption(f"Latency: `{meta.get('latency', 0):.1f} ms`")


# ==========================================
# USER INPUT & CHAT LOGIC
# ==========================================
user_query = st.chat_input("Ask a question regarding German student visas, APS, blocked accounts, or university admission...")

if selected_sample:
    user_query = selected_sample
elif selected_option_click:
    user_query = selected_option_click

if user_query:
    st.session_state["messages"].append({
        "role": "user",
        "content": user_query,
        "sources": [],
        "metadata": {}
    })
    with st.chat_message("user"):
        st.markdown(user_query)

    with st.chat_message("assistant"):
        with st.spinner("Executing 3-Agent ReAct Pipeline (Research -> Analyst -> Writer)..."):
            try:
                if "3-Agent ReAct" in rag_mode:
                    agentic_res: AgenticRAGResponse = run_agentic_rag_pipeline(user_query)
                    answer_text = agentic_res.final_answer
                    sources_list = agentic_res.sources
                    research_steps_list = agentic_res.research_steps
                    metadata_info = {
                        "path": "3_AGENT_REACT_ORCHESTRATOR",
                        "latency": agentic_res.total_latency_ms,
                        "is_grounded": True
                    }
                else:
                    req = RAGQueryRequest(question=user_query, top_k=5)
                    crag_res: RAGResponse = rag_answer(req)
                    answer_text = crag_res.answer
                    sources_list = [s.model_dump() for s in crag_res.sources]
                    research_steps_list = []
                    metadata_info = {
                        "path": crag_res.retrieval_path,
                        "latency": crag_res.latency_ms,
                        "is_grounded": crag_res.is_grounded
                    }

                st.markdown(answer_text)

                if research_steps_list:
                    with st.expander("Developer Debug: ReAct Execution Steps", expanded=False):
                        for step in research_steps_list:
                            st.markdown(f"**Iteration {step['iteration']}** ({step['action']})")
                            st.markdown(f"- *Thought:* {step['thought']}")
                            st.markdown(f"- *Observation:* {step['observation']}")

                if sources_list:
                    with st.expander("Verified Official Sources Used", expanded=True):
                        for s in sources_list:
                            st.markdown(f"- [{s['name']}]({s['url']}) (Relevance Score: {s.get('score', 0):.4f})")

                col1, col2 = st.columns(2)
                with col1:
                    st.caption(f"Engine Path: `{metadata_info['path']}`")
                with col2:
                    st.caption(f"Latency: `{metadata_info['latency']:.1f} ms`")

                st.session_state["messages"].append({
                    "role": "assistant",
                    "content": answer_text,
                    "sources": sources_list,
                    "research_steps": research_steps_list,
                    "metadata": metadata_info
                })

            except Exception as e:
                err_msg = f"An error occurred: {e}"
                st.error(err_msg)
