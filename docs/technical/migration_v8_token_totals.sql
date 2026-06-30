-- Company Detection DB Migration
-- Version: 8.0.0 - normalize stored totals to input + output.

UPDATE llm_calls
SET total_tokens = prompt_tokens + completion_tokens
WHERE total_tokens IS DISTINCT FROM (prompt_tokens + completion_tokens);
