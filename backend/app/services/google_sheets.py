from __future__ import annotations
import json
import gspread
from oauth2client.service_account import ServiceAccountCredentials
from typing import Callable


def _get_gspread_client(service_account_json: str) -> gspread.Client:
    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive",
    ]
    sa_info = json.loads(service_account_json)
    creds = ServiceAccountCredentials.from_json_keyfile_dict(sa_info, scope)
    return gspread.authorize(creds)


def connect_worksheet(sheet_name: str, spreadsheet_id: str, service_account_json: str) -> gspread.Worksheet:
    client = _get_gspread_client(service_account_json)
    return client.open_by_key(spreadsheet_id).worksheet(sheet_name)


def get_all_rows(sheet_name: str, spreadsheet_id: str, service_account_json: str) -> list[list[str]]:
    ws = connect_worksheet(sheet_name, spreadsheet_id, service_account_json)
    return ws.get_all_values()


def get_recipe_data(sheet_name: str, spreadsheet_id: str, service_account_json: str) -> tuple[list[str], list[str]]:
    rows = get_all_rows(sheet_name, spreadsheet_id, service_account_json)
    img_list: list[str] = []
    recipe_list: list[str] = []
    for row in rows:
        if len(row) >= 2:
            img_list.append(row[0])
            recipe_list.append(row[1])
    return img_list, recipe_list


def get_row_data(sheet_name: str, row_index: int, spreadsheet_id: str, service_account_json: str) -> list[str] | None:
    rows = get_all_rows(sheet_name, spreadsheet_id, service_account_json)
    if not rows or row_index >= len(rows):
        return None
    return rows[row_index]


def update_cell(sheet_name: str, row: int, col: int, value: str, spreadsheet_id: str, service_account_json: str, log: Callable[[str], None] | None = None):
    _log = log or print
    ws = connect_worksheet(sheet_name, spreadsheet_id, service_account_json)
    ws.update_cell(row + 1, col + 1, value)
    col_letter = chr(65 + col)
    _log(f"Updated {sheet_name} - column {col_letter} row {row + 1}")


def get_preview(sheet_name: str, spreadsheet_id: str, service_account_json: str, max_rows: int = 10) -> list[list[str]]:
    rows = get_all_rows(sheet_name, spreadsheet_id, service_account_json)
    return rows[:max_rows]
