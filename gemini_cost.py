#!/usr/bin/env python3
import os
import json
import argparse
from typing import TypedDict, Tuple
from glob import glob
from datetime import datetime

class Tokens(TypedDict):
    input: int
    output: int
    cached: int
    total: int

class GeminiRecord(TypedDict):
    type: str
    model: str
    tokens: Tokens
    timestamp: str

COST_MAP = {
    "gemini-2.5-pro": {
        "input": 1.25,
        "output": 10.00,
        "cache_read": 0.31,
    },
    "gemini-2.5-flash": {
        "input": 0.30,
        "output": 2.50,
        "cache_read": 0.075,
    },
    "gemini-2.0-flash": {
        "input": 0.10,
        "output": 0.40,
        "cache_read": 0.025,
    },
    "gemini-3-flash-preview": {
        "input": 0.50,
        "output": 3.00,
        "cache_read": 0.0,
    },
    "gemini-3-pro-preview": {
        "input": 2.00,
        "output": 12.00,
        "cache_read": 0.0,
    },
    "gemini-3.1-pro-preview": {
        "input": 2.00,
        "output": 12.00,
        "cache_read": 0.0,
    },
}

def get_cost_per_m(model: str):
    for pattern, pricing in COST_MAP.items():
        if pattern in model.lower():
            return pricing
    return None

def session_cost(path: str) -> Tuple[int, float]:
    acc_tokens = 0
    acc_cost = 0.0
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            
            if data.get("type") != "gemini":
                continue
            
            model = data.get("model", "")
            tokens = data.get("tokens", {})
            if not tokens:
                continue
                
            input_tok = tokens.get("input", 0)
            output_tok = tokens.get("output", 0)
            cache_read_tok = tokens.get("cached", 0)
            total_tok = tokens.get("total", input_tok + output_tok + cache_read_tok)
            
            cost_rates = get_cost_per_m(model)
            if cost_rates:
                cost = (input_tok * cost_rates["input"] + 
                        output_tok * cost_rates["output"] + 
                        cache_read_tok * cost_rates["cache_read"]) / 1e6
                acc_cost += cost
            
            acc_tokens += total_tok
            
    return acc_tokens, acc_cost

def main():
    parser = argparse.ArgumentParser("Gemini CLI cost calculator")
    parser.add_argument(
        "path", help="Path to folder of gemini sessions or single jsonl"
    )
    args = parser.parse_args()
    path = args.path
    files = []
    if os.path.isdir(path):
        files = list(glob(os.path.join(path, "**/*.jsonl"), recursive=True))
        files.sort()
        if not files:
            print("No sessions found")
            return
    elif os.path.isfile(path):
        files = [path]
    else:
        print(f"Invalid path: {path}")
        return
        
    acc_tokens = 0
    acc_cost = 0.0
    for file in files:
        tokens, cost = session_cost(file)
        if tokens == 0:
            continue
        print(f"{file}")
        print(f"  Tokens: {tokens}")
        print(f"    Cost: ${cost:.2f}")
        acc_tokens += tokens
        acc_cost += cost

    if len(files) > 1:
        print("\n===\n")
        print(f"Total tokens: {acc_tokens}")
        print(f"  Total cost: ${acc_cost:.2f}")

if __name__ == "__main__":
    main()
