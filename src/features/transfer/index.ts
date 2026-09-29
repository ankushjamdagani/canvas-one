/**
 * Transfer module for System Studio (RV-10a).
 *
 * Implements specifications from:
 * - specs/revamp/contracts/parts-and-export.md ("JSON, images and files", "CSV v1", "Mermaid v1")
 * - specs/revamp/requirements.md (R10: Entry and transfer)
 * - specs/revamp/contracts/storage.md (§4 portable v9 bundle, §5 repository API)
 * - specs/revamp/decisions.md (D12, D19, D37, D42)
 */

export * from './types';
export * from './filename';
export * from './limitations';
export * from './json-transfer';
export * from './svg-export';
export * from './png-export';
export * from './mermaid-export';
export * from './csv-export';
export * from './ui';
