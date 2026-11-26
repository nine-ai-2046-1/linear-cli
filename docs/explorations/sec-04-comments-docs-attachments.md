# Section 4 Exploration: Comments, Documents, and Attachments

## File Upload & Private Storage Download Flow

```text
`linear attachment upload --issue NIN-11 --file ./report.pdf`
    |
    +--> 1. Stat file bytes + infer MIME type
    |
    +--> 2. SDK `client.fileUpload(contentType, filename, size)`
    |        returns `{ uploadFile: { uploadUrl, assetUrl, headers } }`
    |
    +--> 3. HTTP PUT raw file Buffer to `uploadUrl` with exact signed `headers`
    |
    +--> 4. SDK `client.createAttachment({ issueId, url: assetUrl, title, subtitle })`
```

And for `linear attachment download <attachment-or-url> --output <path>`:
- Linear stores private uploads under `uploads.linear.app` requiring the folder's active `Authorization` header (`Bearer <token>` for OAuth/app or `<apiKey>` for Personal API Key). External non-Linear URLs must NEVER receive Linear's `Authorization` header (to prevent credential exfiltration!).

## SDK Nuances Verified in `@linear/sdk@104.0.0`

1. **Comment Thread Replies**: `CommentCreateInput.parentId` requires the root comment UUID of the thread plus the same parent resource (`issueId` or `projectId`). When `linear comment reply <comment-id>` is invoked on a nested reply, we inspect `comment.parent` so we always attach to the root thread ID and its enclosing `issueId`/`projectId`!
2. **Documents**: `client.documents()`, `client.searchDocuments(term)`, `client.document(id)`, `client.createDocument(input)`, `client.updateDocument(id, input)`, `client.deleteDocument(id)` (which archives/trashes the document and returns `DocumentArchivePayload`), and `client.unarchiveDocument(id)`.
