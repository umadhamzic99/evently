# Project Memory & Instructions: Evently

## Connected NotebookLM Knowledge Base
This project (**Evently**) is linked to the following Google NotebookLM notebook:

- **Notebook Title:** `Event Management System`
- **Notebook ID:** `7561820b-d9d3-4c6f-8740-ac5c78c7de8b`
- **CLI Aliases:** `evently`, `event-management-system`

## Shell & Commands
- **Always use PowerShell syntax** for all commands — never bash (`&&`, `$()`, etc.).
- **Always `Set-Location` to the project root first** before running any project commands:
  ```powershell
  Set-Location "c:\Users\PCUser\Desktop\Evently"
  ```

## Agent Guidelines
1. **Grounded Context:**
   - Always reference and ground architecture, domain requirements, and design decisions in the `Event Management System` notebook.
   - Use the `gemini-notebook-mcp` tools or `nlm query notebook evently "<prompt>"` to search and extract context from the notebook's sources.
2. **Syncing & Updating Knowledge:**
   - Ingest new project documentation, API specs, and research into this notebook using `nlm source add evently --file <path>` or via MCP tool calls.
   - Keep project plans and summaries aligned with the sources in this notebook.
