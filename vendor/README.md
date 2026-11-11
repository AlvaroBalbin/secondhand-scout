# Reused Vinted client

The three JavaScript modules in `vinted-client/` are copied, unchanged, from
[googlarz/vinted-mcp-cli](https://github.com/googlarz/vinted-mcp-cli), revision
`b767b15`, package version 1.6.3. Its MIT license is included beside the modules.
They provide catalogue parsing, search URL construction and listing operations.
Our transport uses standard fetch so the same parser runs locally and in a Worker.
No browser sessions, cookies, personal shopping history or account credentials
from the original shopping chat are included.
