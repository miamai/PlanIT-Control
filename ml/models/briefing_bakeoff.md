# Briefing model bake-off

62 real 2025 site-days (go / caution / no-go mix, two backtest storm days, some with a live lightning alert or crew wildlife report). Greedy decoding, thinking off, one retry with the checker's feedback before falling back to the template.

| metric | Qwen3-4B-Instruct-2507-4bit | Qwen3.5-4B-MLX-4bit |
|---|---|---|
| pass_first_try | 0.968 | 0.968 |
| pass_after_retry | 1.0 | 1.0 |
| template_fallback_rate | 0.0 | 0.0 |
| seconds_per_briefing_median | 6.35 | 6.58 |
| tokens_per_second | 20.4 | 20.3 |
| peak_gpu_memory_gb | 2.91 | 3.26 |
| load_seconds | 4.8 | 3.2 |
| words_median | 89 | 101 |
| pass_with_alert | 1.0 | 1.0 |
| first-try problems | number 66 (2) | number 7.7 (1), number 9.1 (1) |
