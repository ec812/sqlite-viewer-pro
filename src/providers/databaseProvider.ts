import * as vscode from 'vscode';
import * as sqlite3 from 'sqlite3';
import * as path from 'path';

export interface TableInfo {
    name: string;
    type: string;
    rowCount?: number;
}

export interface ColumnInfo {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: any;
    pk: number;
}

export interface QueryResult {
    columns: string[];
    values: any[][];
    rowCount: number;
    error?: string;
}

export class DatabaseProvider implements vscode.Disposable {
    private connections: Map<string, sqlite3.Database> = new Map();

    async openDatabase(dbPath: string): Promise<sqlite3.Database> {
        if (this.connections.has(dbPath)) {
            return this.connections.get(dbPath)!;
        }

        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
                if (err) {
                    reject(new Error(`Failed to open database: ${err.message}`));
                    return;
                }
                
                // Enable foreign keys
                db.run('PRAGMA foreign_keys = ON');
                
                this.connections.set(dbPath, db);
                resolve(db);
            });
        });
    }

    async closeDatabase(dbPath: string): Promise<void> {
        const db = this.connections.get(dbPath);
        if (db) {
            return new Promise((resolve, reject) => {
                db.close((err) => {
                    if (err) {
                        reject(new Error(`Failed to close database: ${err.message}`));
                        return;
                    }
                    
                    this.connections.delete(dbPath);
                    resolve();
                });
            });
        }
    }

    async getTables(dbPath: string): Promise<TableInfo[]> {
        const db = await this.openDatabase(dbPath);
        
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    name, 
                    type
                FROM 
                    sqlite_master 
                WHERE 
                    type IN ('table', 'view') 
                    AND name NOT LIKE 'sqlite_%'
                ORDER BY 
                    CASE type WHEN 'table' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,
                    name
            `;
            
            db.all(query, async (err, tables: TableInfo[]) => {
                if (err) {
                    reject(new Error(`Failed to get tables: ${err.message}`));
                    return;
                }
                
                // Add row counts for tables (not views)
                for (const table of tables.filter(t => t.type === 'table')) {
                    try {
                        const countResult = await this.runQuery(dbPath, `SELECT COUNT(*) as count FROM "${table.name}"`);
                        if (countResult.values && countResult.values.length > 0) {
                            table.rowCount = countResult.values[0][0];
                        }
                    } catch (error) {
                        console.error(`Failed to get row count for ${table.name}:`, error);
                    }
                }
                
                resolve(tables);
            });
        });
    }

    async getTableInfo(dbPath: string, tableName: string): Promise<ColumnInfo[]> {
        const db = await this.openDatabase(dbPath);
        
        return new Promise((resolve, reject) => {
            const query = `PRAGMA table_info("${tableName}")`;
            
            db.all(query, (err, columns: ColumnInfo[]) => {
                if (err) {
                    reject(new Error(`Failed to get table info: ${err.message}`));
                    return;
                }
                
                resolve(columns);
            });
        });
    }

    async runQuery(dbPath: string, query: string): Promise<QueryResult> {
        const db = await this.openDatabase(dbPath);
        
        return new Promise((resolve) => {
            db.all(query, [], function(err, rows) {
                if (err) {
                    resolve({
                        columns: [],
                        values: [],
                        rowCount: 0,
                        error: err.message
                    });
                    return;
                }
                
                if (!rows || rows.length === 0) {
                    let rowsAffected = 0;
                    
                    // For non-SELECT queries, try to get the number of affected rows
                    // 'this' in the callback refers to the Statement object
                    if ((this as any).changes !== undefined) {
                        rowsAffected = (this as any).changes;
                    }
                    
                    resolve({
                        columns: [],
                        values: [],
                        rowCount: rowsAffected
                    });
                    return;
                }
                
                // Extract column names from the first row
                const columns = Object.keys(rows[0] as object);
                
                // Convert to array of arrays for better rendering
                const values = rows.map((row: any) => {
                    return columns.map(col => (row as any)[col]);
                });
                
                resolve({
                    columns,
                    values,
                    rowCount: rows.length
                });
            });
        });
    }

    async getTableData(dbPath: string, tableName: string, limit: number = 1000, offset: number = 0): Promise<QueryResult> {
        const query = `SELECT * FROM "${tableName}" LIMIT ${limit} OFFSET ${offset}`;
        return this.runQuery(dbPath, query);
    }

    async getTableStructure(dbPath: string, tableName: string): Promise<string> {
        const db = await this.openDatabase(dbPath);
        
        return new Promise((resolve, reject) => {
            const query = `SELECT sql FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')`;
            
            db.get(query, [tableName], (err, result: {sql: string}) => {
                if (err) {
                    reject(new Error(`Failed to get table structure: ${err.message}`));
                    return;
                }
                
                if (!result || !result.sql) {
                    reject(new Error(`No structure found for ${tableName}`));
                    return;
                }
                
                resolve(result.sql);
            });
        });
    }
    
    async getIndexes(dbPath: string, tableName: string): Promise<any[]> {
        const db = await this.openDatabase(dbPath);
        
        return new Promise((resolve, reject) => {
            const query = `PRAGMA index_list("${tableName}")`;
            
            db.all(query, async (err, indexes) => {
                if (err) {
                    reject(new Error(`Failed to get indexes: ${err.message}`));
                    return;
                }
                
                // Get the columns for each index
                for (const index of indexes as any[]) {
                    try {
                        const indexInfoQuery = `PRAGMA index_info("${(index as any).name}")`;
                        (index as any).columns = await new Promise<any[]>((resolve, reject) => {
                            db.all(indexInfoQuery, (err, columns) => {
                                if (err) {
                                    reject(err);
                                    return;
                                }
                                resolve(columns);
                            });
                        });
                    } catch (error) {
                        console.error(`Error getting index info for ${(index as any).name}:`, error);
                        (index as any).columns = [];
                    }
                }
                
                resolve(indexes);
            });
        });
    }

    async getTableConstraints(dbPath: string, tableName: string): Promise<any[]> {
        const db = await this.openDatabase(dbPath);
        
        return new Promise((resolve, reject) => {
            const foreignKeyQuery = `PRAGMA foreign_key_list("${tableName}")`;
            
            db.all(foreignKeyQuery, (err, constraints) => {
                if (err) {
                    reject(new Error(`Failed to get constraints: ${err.message}`));
                    return;
                }
                
                resolve(constraints);
            });
        });
    }

    async getDatabaseInfo(dbPath: string): Promise<any> {
        const db = await this.openDatabase(dbPath);
        
        const pragmas = [
            'user_version', 'application_id', 'auto_vacuum', 
            'automatic_index', 'busy_timeout', 'cache_size',
            'journal_mode', 'locking_mode', 'page_size',
            'max_page_count', 'secure_delete', 'synchronous'
        ];
        
        const results: Record<string, any> = {};
        
        for (const pragma of pragmas) {
            results[pragma] = await new Promise((resolve) => {
                db.get(`PRAGMA ${pragma}`, (err, result) => {
                    if (err || !result) {
                        resolve('N/A');
                        return;
                    }
                    
                    resolve(Object.values(result)[0]);
                });
            });
        }
        
        // Get file size
        try {
            const stats = await vscode.workspace.fs.stat(vscode.Uri.file(dbPath));
            results.fileSize = this.formatFileSize(stats.size);
        } catch (error) {
            results.fileSize = 'Unknown';
        }
        
        // Get database filename
        results.filename = path.basename(dbPath);
        
        return results;
    }

    private formatFileSize(bytes: number): string {
        if (bytes < 1024) {
            return bytes + ' B';
        } else if (bytes < 1024 * 1024) {
            return (bytes / 1024).toFixed(2) + ' KB';
        } else if (bytes < 1024 * 1024 * 1024) {
            return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
        } else {
            return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        }
    }

    dispose(): void {
        // Close all database connections
        this.connections.forEach((db, path) => {
            db.close();
        });
        
        this.connections.clear();
    }
}