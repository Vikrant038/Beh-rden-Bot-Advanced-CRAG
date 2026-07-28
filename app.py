import os
import time
import streamlit as st
from dotenv import load_dotenv

from src.rag import rag_answer, RAGQueryRequest, RAGResponse

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
            "metadata": {},
            "is_ambiguous": False,
            "clarification_options": []
        }
    ]


# ==========================================
# HEADER SECTION
# ==========================================
st.markdown("""
<div class="header-container">
    <div class="header-title">Behoerden-Bot — German Visa & Study Assistant</div>
    <div class="header-subtitle">Enterprise Corrective RAG (CRAG) | BGE 768d Dense Vectors | BM25 Keyword Search | Cross-Encoder Re-Ranking</div>
</div>
""", unsafe_allow_html=True)


# ==========================================
# SIDEBAR NAVIGATION & TOPIC EXPLORER
# ==========================================
with st.sidebar:
    st.title("Navigation & Explorer")
    
    st.markdown("---")
    st.subheader("Sample Queries")
    
    sample_queries = [
        "What documents are required for a German student visa application from India?",
        "What is the APS certificate and why is it mandatory for Indian students?",
        "How does a blocked account (Sperrkonto) work and what is the Expatrio process?",
        "What is uni-assist and how do Indian students apply through it?"
    ]
    
    selected_sample = None
    for q in sample_queries:
        if st.button(q, key=f"sample_{q[:20]}"):
            selected_sample = q

    st.markdown("---")
    st.subheader("Pipeline Architecture")
    st.markdown("""
    - **Query Disambiguation Node:** Active
    - **Vector Embeddings:** BAAI/bge-base-en-v1.5 (768d)
    - **Sparse Search:** BM25 Okapi (rank_bm25)
    - **Fusion Algorithm:** Reciprocal Rank Fusion (RRF)
    - **Re-Ranker:** BAAI/bge-reranker-base (Cross-Encoder)
    - **LLM Engine:** Groq (llama-3.1-8b-instant)
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
        
        # Render Clarification Buttons if Ambiguous
        if msg.get("is_ambiguous") and msg.get("clarification_options"):
            st.write("Please select your intended topic below:")
            for opt_idx, opt in enumerate(msg["clarification_options"]):
                if st.button(f"-> {opt}", key=f"opt_{idx}_{opt_idx}"):
                    selected_option_click = opt
        
        # Render Sources Expander ONLY if sources exist
        if msg.get("sources"):
            with st.expander("Verified Official Sources Used", expanded=False):
                for s in msg["sources"]:
                    st.markdown(f"- [{s['name']}]({s['url']}) (Relevance Score: {s.get('score', 0):.4f})")
                    
        # Render Latency & Path Metadata
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
        "metadata": {},
        "is_ambiguous": False,
        "clarification_options": []
    })
    with st.chat_message("user"):
        st.markdown(user_query)

    with st.chat_message("assistant"):
        with st.spinner("Analyzing Query Intent & Executing CRAG Pipeline..."):
            try:
                req = RAGQueryRequest(question=user_query, top_k=5)
                response: RAGResponse = rag_answer(req)
                
                answer_text = response.answer
                sources_list = [s.model_dump() for s in response.sources]
                metadata_info = {
                    "path": response.retrieval_path,
                    "latency": response.latency_ms,
                    "is_grounded": response.is_grounded
                }

                st.markdown(answer_text)
                
                # Render Clarification Buttons if Disambiguation Triggered
                if response.is_ambiguous and response.clarification_options:
                    st.write("Please select your intended topic below:")
                    for opt_idx, opt in enumerate(response.clarification_options):
                        if st.button(f"-> {opt}", key=f"opt_new_{opt_idx}"):
                            selected_option_click = opt
                
                if sources_list:
                    with st.expander("Verified Official Sources Used", expanded=True):
                        for s in sources_list:
                            st.markdown(f"- [{s['name']}]({s['url']}) (Relevance Score: {s.get('score', 0):.4f})")

                col1, col2 = st.columns(2)
                with col1:
                    st.caption(f"Engine Path: `{response.retrieval_path}`")
                with col2:
                    st.caption(f"Latency: `{response.latency_ms:.1f} ms`")

                st.session_state["messages"].append({
                    "role": "assistant",
                    "content": answer_text,
                    "sources": sources_list,
                    "metadata": metadata_info,
                    "is_ambiguous": response.is_ambiguous,
                    "clarification_options": response.clarification_options
                })

            except Exception as e:
                err_msg = f"An error occurred: {e}"
                st.error(err_msg)
