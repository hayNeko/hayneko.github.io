# Verified facts — DeepSeek models (subagent report, condensed)
Source: internal research dispatch. Full table kept in transcript; key rows below are the ones used on screen.

MODEL / ARCHITECTURE (DeepSeek-V3, official)
- 671B total parameters, 37B activated per token (5.51% activation ratio)
- 61 transformer layers, hidden dim 7168, 128 attention heads x 128 head_dim
- MLA: KV compression d_c = 512, query compression 1536, decoupled RoPE key dim 64
- KV cache per token = (512 + 64) x 61 = 35,136 elements = 70,272 B = 68.6 KiB (BF16)
- MoE: 256 routed experts + 1 shared; 8 routed activated per token; expert intermediate 2048
- node-limited routing: max 4 nodes per token
- vocabulary 128K (129,280 ids), byte-level BPE; pre-training 14.8T tokens; context 128K (YaRN)
TRAINING
- FP8 mixed precision, E4M3 on all tensors; per-1x128 activation tile, 128x128 weight block
- 2,048 NVIDIA H800 GPUs; 2.788M H800 GPU-hours total; 180K GPU-hours per 1T tokens
- $5.576M at assumed $2/GPU-hour — explicitly EXCLUDES prior research & ablations. Do not present as "cost to build".
- shipped weights are 685B = 671B + 14B MTP module
- MTP depth 1; aux-loss-free load balancing (bias update 0.001 early, then 0)
DeepSeek-R1: same 671B/37B/128K MoE, trained FROM V3-Base; GRPO (keeps KL term); ~800k SFT samples.
  AIME2024 pass@1 79.8; MMLU 90.8; Codeforces 2029 Elo (96.3 pct).
DeepSeek-V2: 236B/21B, MLA cut KV cache 93.3% vs DeepSeek 67B, 5.76x throughput, 236B/21B.
TOKENIZER (API docs)
- 1 English character ~ 0.3 token; 1 Chinese character ~ 0.6 token  => ~2x per character
SERVING (official, Feb-Mar 2025)
- $87,072/day at $2/H800-hr; 226.75 avg nodes; 608B input tokens/day (56.3% KV-cache hits), 168B output/day
- ~73.7k tok/s prefill or ~14.8k tok/s decode per H800 node; avg output 20-22 tok/s
- FP8 matmul/dispatch, BF16 core MLA

CORRECTIONS (never put these on screen)
- "$5.576M to build V3" — wrong framing (rental assumption, excludes research).
- "671B" alone — 685B shipped; 37B active.
- "2 shared experts" — V3 has 1 (V2 had 2).
- "93.3% vs MHA" — it is vs DeepSeek 67B.
- "MLA KV = d_c * l" — it is (d_c + d_h^R) * l.
- "R1 dropped KL" — GRPO in R1 keeps the KL term.
- "14.8T total tokens" — pre-training corpus only.
