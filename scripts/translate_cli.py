#!/usr/bin/env python3
"""
CLI tool for AI-powered i18n Excel translation using DashScope (Qwen).

Usage:
  python translate_cli.py --excel input.xlsx --out output.xlsx --api-key YOUR_KEY
  python translate_cli.py --excel input.xlsx --out output.xlsx --api-key YOUR_KEY --keys key1,key2
  python translate_cli.py --excel input.xlsx --out output.xlsx --api-key YOUR_KEY --langs en,th

Dependencies:
  pip install pandas openpyxl dashscope
"""

import argparse
import sys
import os
import re
import concurrent.futures
from http import HTTPStatus

try:
    import pandas as pd
except ImportError:
    print("Error: pandas is required. Run: pip install pandas openpyxl", file=sys.stderr)
    sys.exit(1)

try:
    import dashscope
    from dashscope import Generation
except ImportError:
    print("Error: dashscope is required. Run: pip install dashscope", file=sys.stderr)
    sys.exit(1)

DEFAULT_PROMPT = (
    "请将以下工程行业 SaaS 软件的中文文案翻译为 {target_lang}。\n"
    "背景信息：这是一个工程行业项目管理 SaaS 及 aPaaS \n"
    "文案内容：{text} \n"
    "译文需符合工程行业表达习惯。针对 SaaS 终端用户，译文应直观、专业、简洁，符合软件 UI 语境。专有名词请参考行业标准翻译。\n"
    "只翻译中文部分，如果中文原文中有英文和符号请严格保留。注意目标语言，不要翻译错语言。不要返回中文。\n"
    "严格保留变量占位符（如 {0}, %s, ${name} 等）不被翻译或破坏。\n"
    "严格保留换行符（\\n）不被翻译或破坏。\n"
    "单位翻译：遇到量词单位如'对、捆、支、副、天'等，必须结合工程材料上下文翻译（例如：捆 -> bundle, 支 -> piece/unit, 副 -> set/pair），严禁机械直译。\n"
    "'红圈'在任何语言下都翻译为'RedO'。"
)

MAX_WORKERS = 5


# -----------------------------------------------------------------------------
# Core translation logic (extracted from app.py, Streamlit-free)
# -----------------------------------------------------------------------------

def is_text_in_script(text, script_ranges):
    if not text:
        return False
    for start, end in script_ranges:
        pattern = f"[{chr(start)}-{chr(end)}]"
        if re.search(pattern, text):
            return True
    return False


def validate_translation_script(text, target_lang):
    lang_code = str(target_lang).lower().strip()
    script_ranges = {
        'th':    [(0x0E00, 0x0E7F)],
        'th-th': [(0x0E00, 0x0E7F)],
        'ja':    [(0x3040, 0x309F), (0x30A0, 0x30FF), (0x4E00, 0x9FBF)],
        'ja-jp': [(0x3040, 0x309F), (0x30A0, 0x30FF), (0x4E00, 0x9FBF)],
        'ko':    [(0xAC00, 0xD7AF)],
        'ko-kr': [(0xAC00, 0xD7AF)],
        'zh':    [(0x4E00, 0x9FFF)],
        'zh-cn': [(0x4E00, 0x9FFF)],
        'zh-tw': [(0x4E00, 0x9FFF)],
        'zh-hk': [(0x4E00, 0x9FFF)],
        'ru':    [(0x0400, 0x04FF)],
        'ru-ru': [(0x0400, 0x04FF)],
        'ar':    [(0x0600, 0x06FF)],
        'ar-sa': [(0x0600, 0x06FF)],
        'ar-ae': [(0x0600, 0x06FF)],
    }
    matched_key = next((k for k in script_ranges if k in lang_code), None)
    if matched_key:
        ranges = script_ranges[matched_key]
        if not is_text_in_script(text, ranges):
            return False, f"Translation does not contain characters for language '{target_lang}'"
    return True, None


NEWLINE_PLACEHOLDER = '{{NEWLINE}}'


def translate_text(text, target_lang, api_key, prompt_template, retry_count=0):
    if not text or (hasattr(pd, 'isna') and pd.isna(text)) or str(text).strip() == "":
        return None, None

    dashscope.api_key = api_key

    # 用占位符保护换行符，防止 AI 翻译时丢失
    text_for_translation = str(text).replace('\n', NEWLINE_PLACEHOLDER)

    try:
        prompt = prompt_template.format(target_lang=target_lang, text=text_for_translation)
        if retry_count > 0:
            prompt += (
                f"\nIMPORTANT: You MUST translate into {target_lang}. "
                "Do NOT return English unless the source text is a proper noun."
            )
    except (KeyError, IndexError, ValueError) as e:
        prompt = f"Translate the following text to {target_lang}:\n{text}"

    try:
        response = Generation.call(
            model='qwen-plus-latest',
            messages=[{'role': 'user', 'content': prompt}],
            result_format='message',
        )
        if response.status_code == HTTPStatus.OK:
            result = response.output.choices[0].message.content.strip()
            # 将占位符还原为真实换行符
            result = result.replace(NEWLINE_PLACEHOLDER, '\n')
            is_valid, _ = validate_translation_script(result, target_lang)
            if not is_valid and retry_count < 1:
                print(f"  [retry] Validation failed for {target_lang}, retrying...")
                return translate_text(text, target_lang, api_key, prompt_template, retry_count=1)
            return result, None
        else:
            err = f"API error [{target_lang}]: {response.code} - {response.message}"
            return None, err
    except Exception as e:
        return None, f"Exception [{target_lang}]: {str(e)}"


def process_sheet(df, api_key, prompt_template, sheet_name,
                  target_keys=None, target_langs=None):
    """Translate empty cells in a sheet. Returns modified DataFrame."""
    if len(df.columns) < 5:
        print(f"  Warning: Sheet '{sheet_name}' has too few columns, skipping.", file=sys.stderr)
        return df

    source_col = df.columns[1]          # 'zh'
    all_target_cols = df.columns[2:-3]   # language columns
    key_col = df.columns[-1]             # 'key'

    if target_langs is not None:
        cols = [c for c in all_target_cols if str(c) in target_langs]
        if not cols:
            print(f"  Warning: None of the specified langs found in '{sheet_name}'.", file=sys.stderr)
            return df
    else:
        cols = all_target_cols

    tasks = []
    for idx, row in df.iterrows():
        if target_keys is not None and str(row.get(key_col, '')) not in target_keys:
            continue
        source = row[source_col]
        if pd.isna(source) or str(source).strip() == '':
            continue
        for lang_col in cols:
            val = row[lang_col]
            if pd.isna(val) or str(val).strip() == '':
                tasks.append({
                    'row_idx': idx,
                    'col_name': lang_col,
                    'source_text': str(source),
                    'target_lang': str(lang_col),
                })

    total = len(tasks)
    if total == 0:
        print(f"  Sheet '{sheet_name}': No empty cells to translate.")
        return df

    print(f"  Sheet '{sheet_name}': {total} cells to translate...")
    errors = []
    completed = 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        future_map = {
            executor.submit(translate_text, t['source_text'], t['target_lang'],
                            api_key, prompt_template): t
            for t in tasks
        }
        for future in concurrent.futures.as_completed(future_map):
            task = future_map[future]
            try:
                text, error = future.result()
                if text:
                    df.at[task['row_idx'], task['col_name']] = text
                if error:
                    errors.append(error)
            except Exception as exc:
                errors.append(str(exc))
            completed += 1
            print(f"\r  Progress: {completed}/{total}", end='', flush=True)

    print()  # newline after progress

    if errors:
        print(f"  {len(errors)} error(s) in sheet '{sheet_name}':", file=sys.stderr)
        for err in errors[:5]:
            print(f"    {err}", file=sys.stderr)
        if len(errors) > 5:
            print(f"    ... and {len(errors) - 5} more", file=sys.stderr)

    return df


# -----------------------------------------------------------------------------
# Entry point
# -----------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='AI-powered i18n Excel translation using DashScope Qwen'
    )
    parser.add_argument('--excel',       required=True, help='Input Excel file path')
    parser.add_argument('--out',         required=True, help='Output Excel file path')
    parser.add_argument('--api-key',     required=True, help='DashScope API Key')
    parser.add_argument('--keys',        help='Comma-separated keys to translate (all empty cells if omitted)')
    parser.add_argument('--langs',       help='Comma-separated target language columns, e.g. en,th (all if omitted)')
    parser.add_argument('--prompt',      help='Custom prompt template string (must contain {text} and {target_lang})')
    parser.add_argument('--prompt-file', help='Path to a file containing the prompt template')
    args = parser.parse_args()

    if not os.path.exists(args.excel):
        print(f"Error: Excel file not found: {args.excel}", file=sys.stderr)
        sys.exit(1)

    # Resolve prompt template
    prompt_template = DEFAULT_PROMPT
    if args.prompt_file:
        if not os.path.exists(args.prompt_file):
            print(f"Error: Prompt file not found: {args.prompt_file}", file=sys.stderr)
            sys.exit(1)
        with open(args.prompt_file, 'r', encoding='utf-8') as f:
            prompt_template = f.read()
    elif args.prompt:
        prompt_template = args.prompt

    if '{text}' not in prompt_template or '{target_lang}' not in prompt_template:
        print("Error: Prompt template must contain {text} and {target_lang}", file=sys.stderr)
        sys.exit(1)

    target_keys = set(args.keys.split(',')) if args.keys else None
    target_langs = set(args.langs.split(',')) if args.langs else None

    print(f"Reading: {args.excel}")
    sheets = pd.read_excel(args.excel, sheet_name=None, dtype=str)

    processed = {}
    for sheet_name, df in sheets.items():
        print(f"\n=== Sheet: {sheet_name} ===")
        processed[sheet_name] = process_sheet(
            df, args.api_key, prompt_template, sheet_name,
            target_keys=target_keys, target_langs=target_langs
        )

    out_dir = os.path.dirname(os.path.abspath(args.out))
    os.makedirs(out_dir, exist_ok=True)

    print(f"\nWriting: {args.out}")
    with pd.ExcelWriter(args.out, engine='openpyxl') as writer:
        for sheet_name, df in processed.items():
            df.to_excel(writer, sheet_name=sheet_name, index=False)

    print(f"Done! Saved to: {args.out}")


if __name__ == '__main__':
    main()
