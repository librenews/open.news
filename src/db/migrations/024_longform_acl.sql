CREATE TABLE IF NOT EXISTS longform_yjs_acl (
  document_name VARCHAR(255) NOT NULL,
  did TEXT NOT NULL,
  permission TEXT NOT NULL DEFAULT 'write',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (document_name, did),
  CONSTRAINT fk_document FOREIGN KEY(document_name) REFERENCES longform_yjs_documents(name) ON DELETE CASCADE
);
