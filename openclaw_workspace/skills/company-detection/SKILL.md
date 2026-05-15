# Company Detection

Use this skill when a Telegram/user message asks to check, classify, inspect, or detect a company signal from an email address.

## Procedure

1. Extract the email from the user message.
2. If there is no valid email, ask for a valid email only.
3. Run:

   ```bash
   node scripts/company_check.js <email> --save
   ```

4. Return the generated report to the user.
5. Do not ask for feedback or a follow-up. This is intended for register automation.

For `/tool_status`, run:

```bash
node scripts/tool_status.js
```

Return the tool status report.

For `/last_report [email]`, run:

```bash
node scripts/last_report.js [email]
```

Return the saved report.

Evidence files are intentional audit snapshots. Retention is bounded by environment variables and `latest.json` / `latest.txt` always point to the newest result.

## Claim Safety

- Corporate/custom domain can imply `possible_company_affiliated`.
- Never claim founder/owner without explicit role evidence.
- Free email with no extra evidence should remain personal/unknown.
- Paid tools unavailable in MVP must be marked skipped, not treated as failure.
