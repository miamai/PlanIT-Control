# Briefing model bake-off

62 real 2025 site-days (go / caution / no-go mix, two backtest storm days, some with a live lightning alert or crew wildlife report). Greedy decoding, thinking off, one retry with the checker's feedback before falling back to the template.

| metric | Qwen3-4B-Instruct-2507-4bit | Qwen3.5-4B-MLX-4bit |
|---|---|---|
| pass_first_try | 0.919 | 0.984 |
| pass_after_retry | 0.968 | 1.0 |
| template_fallback_rate | 0.032 | 0.0 |
| seconds_per_briefing_median | 6.63 | 6.23 |
| tokens_per_second | 19.7 | 19.0 |
| peak_gpu_memory_gb | 2.91 | 3.26 |
| load_seconds | 4.7 | 3.7 |
| words_median | 83 | 86 |
| pass_with_alert | 1.0 | 1.0 |
| first-try problems | number 0.16 (1), number 66 (1), number 88 (1), number 44 (1), number 0.103 (1) | leaves out (1) |
