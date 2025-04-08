# SQLite Viewer Pro

![SQLite Viewer Pro](https://img.shields.io/badge/SQLite-Viewer%20Pro-blue)

A professional SQLite database viewer extension for Visual Studio Code. Easily browse, query, and manage your SQLite databases without leaving your editor.

## Features

- **Database Explorer**: Browse tables, views, and their structure in a clean interface
- **SQL Query Editor**: Write and execute custom SQL queries with syntax highlighting
- **Query Results**: View query results in a formatted table with pagination
- **Table Data**: Browse table data with sorting and filtering capabilities
- **Schema Information**: Examine table structures, indexes, and foreign key constraints
- **SQL Formatting**: Automatically format your SQL queries for better readability

## Installation

Install this extension from the VS Code Marketplace or by searching for "SQLite Viewer Pro" in the Extensions view (Ctrl+Shift+X).

## Requirements

- Visual Studio Code version 1.75.0 or higher
- SQLite database files (.db, .sqlite, or .sqlite3)

## Usage

### Opening a Database

1. Right-click on a SQLite database file (.db, .sqlite, or .sqlite3) in the Explorer
2. Select "SQLite Viewer Pro: Open Database" from the context menu
3. The database viewer will open in a new tab

### Browsing Tables

1. The left sidebar shows all tables and views in your database
2. Click on a table name to view its data
3. Use the tabs at the top to switch between Data, Structure, Indexes, and Constraints views

### Running SQL Queries

1. Click on the "SQL Query" tab
2. Enter your SQL query in the editor
3. Click the "Run" button or press F5 to execute the query
4. Results will appear in the table below
5. Use the "Format" button to automatically format your SQL query

### Refreshing Data

If you make changes to your database outside of the extension, click the "Refresh" button to update the view.

## Extension Settings

This extension contributes the following settings:

- `sqliteViewerPro.limitRows`: Maximum number of rows to fetch per query (default: 1000)
- `sqliteViewerPro.darkTheme`: Use dark theme for SQLite viewer (default: true)

## Tips and Tricks

- Double-click on a table name to quickly view its data
- Use the search box in the results table to filter data
- Right-click on column headers to sort data
- The status bar shows the number of rows and query execution time

## Release Notes

### 0.1.0

- Initial release of SQLite Viewer Pro
- Basic table browsing and data viewing
- SQL query editor with syntax highlighting
- Table structure, indexes, and constraints views
- Dark and light theme support

## Feedback and Contributions

If you find any bugs or have feature requests, please open an issue on the [GitHub repository](https://github.com/YourUsername/sqlite-viewer-pro).

## License

This extension is licensed under the MIT License.
**Enjoy!**
