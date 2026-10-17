# Briefing model bake-off

62 real 2025 site-days (go / caution / no-go mix, two backtest storm days, some with a live lightning alert or crew wildlife report). Greedy decoding, thinking off, one retry with the checker's feedback before falling back to the template.

| metric | Qwen3.5-4B-MLX-4bit |
|---|---|
| pass_first_try | 0.968 |
| pass_after_retry | 1.0 |
| sent_faithful | 1.0 |
| template_fallback_rate | 0.0 |
| seconds_per_briefing_median | 6.61 |
| tokens_per_second | 19.6 |
| peak_gpu_memory_gb | 3.26 |
| load_seconds | 5.2 |
| words_median | 100 |
| pass_with_alert | 1.0 |
| first-try problems | length 173 (1), length 183 (1) |
