# Publish to Confluence (Cookie-based)

A simple Obsidian plugin that allows you to **publish your notes from Obsidian directly to Atlassian Confluence**.  
Instead of OAuth or API tokens, this plugin uses your **authenticated browser cookies** to connect with Confluence.  

> ⚠️ **Note**: Since cookies may expire, you may need to update them regularly from your browser.  

---

## ✨ Features

- Publish any note in your Obsidian vault to Confluence
- Supports nested folder → Confluence page hierarchy  
- Uses **Confluence Storage Format** to render Markdown correctly
- Configure once, then publish with a single command

---

## ⚙️ Settings

Go to **Settings → Plugin Options → Confluence Publisher** and configure the following fields:

| Setting | Type | Description |
|---------|------|-------------|
| `confluenceHost` | `string` | Your Confluence base URL (e.g. `http://confluence.example.com:8090`) |
| `cookie` | `string` | Authentication cookie copied from your logged-in browser session (`seraph.confluence` + `JSESSIONID`) |
| `spaceKey` | `string` | The target Confluence space key where pages will be published |
| `rootPageTitle` | `string` | The root Confluence page under which all pages will be created |
| `rootFolderPath` | `string` | The root folder path in your Obsidian vault that maps to the Confluence hierarchy |

---

## 🚀 Usage

1. Configure plugin settings (see above)  
2. Open the Obsidian note you want to publish  
3. Run the command:  
   **“Publish to Confluence”** from the command palette  
4. The note will be uploaded to Confluence under the specified `rootPageTitle`

---

## 🔒 Security Notes

- Your Confluence **cookies are stored locally** in Obsidian settings and are never uploaded anywhere else.  
- Since cookies can expire, you may need to re-copy them from your browser periodically.  
- Use at your own risk, especially if your Confluence instance is shared or public.

---
