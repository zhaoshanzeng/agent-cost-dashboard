#!/usr/bin/env python3
"""Export a Gemini CLI JSONL session file to a styled HTML transcript.

Usage: python3 gemini_export.py <input.jsonl> <output.html>
"""

import html
import json
import re
import sys
from pathlib import Path
from datetime import datetime


def escape(text: str) -> str:
    return html.escape(text)


def render_text(text: str) -> str:
    """Render text with basic markdown-ish formatting."""
    if not text:
        return ""
    # Code blocks: ```lang\n...\n```
    def replace_code_block(m):
        lang = escape(m.group(1) or "")
        code = escape(m.group(2))
        label = f'<span class="code-lang">{lang}</span>' if lang else ""
        return f'<div class="code-block">{label}<pre><code>{code}</code></pre></div>'

    text = re.sub(
        r"```(\w*)\n(.*?)```", replace_code_block, text, flags=re.DOTALL
    )
    # Inline code
    text = re.sub(r"`([^`]+)`", r'<code class="inline-code">\1</code>', text)
    # Bold
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    # Convert newlines to <br> outside of code blocks
    parts = re.split(r'(<div class="code-block">.*?</div>)', text, flags=re.DOTALL)
    result = []
    for part in parts:
        if part.startswith('<div class="code-block">'):
            result.append(part)
        else:
            result.append(part.replace("\n", "<br>\n"))
    return "".join(result)


CSS = """\
:root {
    --bg-primary: #0d1117;
    --bg-secondary: #161b22;
    --bg-tertiary: #21262d;
    --border-color: #30363d;
    --text-primary: #e6edf3;
    --text-secondary: #8b949e;
    --accent-blue: #58a6ff;
    --accent-green: #3fb950;
    --accent-purple: #a371f7;
    --accent-yellow: #d29922;
    --accent-red: #f85149;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    background: var(--bg-primary);
    color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    line-height: 1.6;
    padding: 20px;
    max-width: 960px;
    margin: 0 auto;
}
.header {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 20px;
}
.header h1 { font-size: 1.2em; margin-bottom: 8px; }
.header .meta { color: var(--text-secondary); font-size: 0.85em; }
.header .meta span { margin-right: 16px; }
.message {
    margin-bottom: 12px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    overflow: hidden;
}
.message .role-label {
    padding: 6px 12px;
    font-size: 0.75em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
.message .content {
    padding: 12px 16px;
    font-size: 0.9em;
}
.msg-user .role-label { background: rgba(88, 166, 255, 0.15); color: var(--accent-blue); }
.msg-user .content { background: var(--bg-secondary); }
.msg-gemini .role-label { background: rgba(63, 185, 80, 0.15); color: var(--accent-green); }
.msg-gemini .content { background: var(--bg-secondary); }
.tool-call {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    margin: 8px 0;
    overflow: hidden;
}
.tool-call .tool-header {
    padding: 6px 12px;
    font-size: 0.8em;
    font-weight: 600;
    color: var(--accent-purple);
    background: rgba(163, 113, 247, 0.1);
    border-bottom: 1px solid var(--border-color);
}
.tool-call .tool-body {
    padding: 8px 12px;
    font-size: 0.82em;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--text-secondary);
}
.tool-result {
    padding: 8px 12px;
    background: rgba(0,0,0,0.2);
    border-top: 1px solid var(--border-color);
}
.tool-result .res-header {
    font-size: 0.75em;
    font-weight: 600;
    margin-bottom: 4px;
    color: var(--accent-yellow);
}
.tool-result .res-body {
    font-size: 0.82em;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    max-height: 400px;
    overflow-y: auto;
}
.code-block { background: #000; border-radius: 6px; margin: 12px 0; border: 1px solid var(--border-color); }
.code-lang { display: block; padding: 4px 12px; font-size: 0.7em; color: var(--text-secondary); border-bottom: 1px solid var(--border-color); }
.code-block pre { padding: 12px; overflow-x: auto; }
.inline-code { background: var(--bg-tertiary); padding: 2px 4px; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
details.thoughts {
    margin: 8px 0;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    overflow: hidden;
}
details.thoughts summary {
    padding: 6px 12px;
    font-size: 0.8em;
    font-weight: 600;
    color: var(--text-secondary);
    background: var(--bg-tertiary);
    cursor: pointer;
}
details.thoughts .thought-item {
    padding: 8px 12px;
    border-top: 1px solid var(--border-color);
    font-size: 0.85em;
}
details.thoughts .thought-subject {
    font-weight: 600;
    color: var(--accent-blue);
    margin-bottom: 4px;
}
"""


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 gemini_export.py <input.jsonl> <output.html>")
        sys.exit(1)

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    lines = []
    session_info = {}
    with open(input_path, "r", encoding="utf-8") as f:
        for line in f:
            try:
                data = json.loads(line)
                if "sessionId" in data:
                    session_info = data
                elif data.get("type") in ("user", "gemini"):
                    lines.append(data)
            except:
                continue

    html_parts = [
        "<!DOCTYPE html>",
        "<html>",
        "<head>",
        '<meta charset="utf-8">',
        f"<title>Gemini Session - {escape(session_info.get('sessionId', 'Unknown'))}</title>",
        f"<style>{CSS}</style>",
        "</head>",
        "<body>",
        '<div class="header">',
        f"<h1>Gemini CLI Session</h1>",
        '<div class="meta">',
        f"<span><strong>Session ID:</strong> {escape(session_info.get('sessionId', 'N/A'))}</span>",
        f"<span><strong>Project Hash:</strong> {escape(session_info.get('projectHash', 'N/A'))}</span>",
        f"<span><strong>Start Time:</strong> {escape(session_info.get('startTime', 'N/A'))}</span>",
        "</div>",
        "</div>",
    ]

    for msg in lines:
        role = msg["type"]
        ts = msg.get("timestamp", "")
        content = msg.get("content", "")
        
        html_parts.append(f'<div class="message msg-{role}">')
        html_parts.append(f'<div class="role-label">{role} <span style="float:right; font-weight:normal; opacity:0.6;">{escape(ts)}</span></div>')
        html_parts.append('<div class="content">')
        
        if role == "user":
            if isinstance(content, list):
                for item in content:
                    if "text" in item:
                        html_parts.append(render_text(item["text"]))
            else:
                html_parts.append(render_text(str(content)))
        
        elif role == "gemini":
            thoughts = msg.get("thoughts", [])
            if thoughts:
                html_parts.append('<details class="thoughts"><summary>Thinking...</summary>')
                for thought in thoughts:
                    html_parts.append('<div class="thought-item">')
                    html_parts.append(f'<div class="thought-subject">{escape(thought.get("subject", ""))}</div>')
                    html_parts.append(f'<div class="thought-desc">{render_text(thought.get("description", ""))}</div>')
                    html_parts.append("</div>")
                html_parts.append("</details>")

            if content:
                html_parts.append(render_text(content))
            
            tool_calls = msg.get("toolCalls", [])
            for tc in tool_calls:
                html_parts.append('<div class="tool-call">')
                html_parts.append(f'<div class="tool-header">Tool Call: {escape(tc.get("name", ""))}</div>')
                html_parts.append(f'<div class="tool-body">{escape(json.dumps(tc.get("args", {}), indent=2))}</div>')
                
                results = tc.get("result", [])
                for res in results:
                    html_parts.append('<div class="tool-result">')
                    html_parts.append('<div class="res-header">Result</div>')
                    html_parts.append('<div class="res-body">')
                    
                    # Try to extract output from functionResponse
                    fr = res.get("functionResponse", {})
                    resp_content = fr.get("response", {})
                    output = resp_content.get("output", "")
                    if not output:
                        output = json.dumps(resp_content, indent=2)
                    
                    if len(output) > 5000:
                        output = output[:5000] + f"\n... ({len(output)-5000} chars truncated)"
                    
                    html_parts.append(f'<pre><code>{escape(output)}</code></pre>')
                    html_parts.append("</div></div>")
                
                html_parts.append("</div>")

            tokens = msg.get("tokens", {})
            if tokens:
                html_parts.append(f'<div style="font-size:0.75em; color:var(--text-secondary); margin-top:12px; border-top:1px solid var(--border-color); padding-top:4px;">Model: {escape(msg.get("model", ""))} | Tokens: {tokens.get("total", 0)} (In: {tokens.get("input", 0)}, Out: {tokens.get("output", 0)}, Cached: {tokens.get("cached", 0)})</div>')

        html_parts.append("</div></div>")

    html_parts.append("</body></html>")

    output_path.write_text("\n".join(html_parts), encoding="utf-8")
    print(f"Exported to {output_path}")


if __name__ == "__main__":
    main()
