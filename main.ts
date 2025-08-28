import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, requestUrl, Setting } from 'obsidian';
import { version } from 'os';

// ---- Types & defaults ----

interface P2CSettings {
	confluenceHost: string;
    cookie: string;
	spaceKey: string;
	rootPageTitle: string;
	rootFolderPath: string;
	/** Mapping from note title -> Confluence Page ID */
	mapping: Record<string, number>;
}

const DEFAULT_SETTINGS: P2CSettings = {
	confluenceHost: "",
    cookie: "",
	spaceKey: "",
	rootPageTitle: "",
	rootFolderPath: "",
	mapping: {},
}

// ---- Main plugin ----

export default class Publish2Confluence extends Plugin {
	settings: P2CSettings;

	async onload() {
		await this.loadSettings();
        
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'publish-to-confluence',
			name: 'Publish Current Note to Confluence',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile) return;

				const spaceKey = this.settings.spaceKey;
				if (!spaceKey || spaceKey.length === 0) {
					new Notice("Please set space key in settings first.");
					return;
				}

				const rootPageTitle = this.settings.rootPageTitle;
				if (!rootPageTitle || rootPageTitle.length === 0) {
					new Notice("Please set root page title in settings first.");
					return;
				}

				const rootPageId = await this.getPageId(spaceKey, rootPageTitle);
				if (rootPageId && rootPageId > 0) {
					let activeFileData = await this.app.vault.read(activeFile);
					const result = await this.syncMarkdownToConfluence(
						spaceKey,
						activeFile.path, 
						activeFileData,
						rootPageTitle,
						rootPageId
					);

					if (result) {
						new Notice(`Successfully published "${activeFile.path}" to Confluence.`);
					} else {
						new Notice(`Failed to publish "${activeFile.path}" to Confluence.`);
					}
				} else {
					new Notice(
						`Please get root page id first.`
					);
				}
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new Publish2ConfluenceSettingTab(this.app, this));
	}

	onunload() {

	}

	// ---- Settings ----

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// ---- Helpers ----

	private syncMarkdownToConfluence = async (
		spaceKey: string,
		filePath: string, 
		content: string,
		rootPageTitle: string,
		rootPageId: number
	): Promise<boolean> => {
		const relativePath = this.getRelativePath(filePath, rootPageTitle);
		const folders = this.getParentFolders(relativePath);
		const fileName = this.getFileName(filePath);

		let result: boolean = true;
		let parentPageId: number = rootPageId;
		for (const folderName of folders) {
			let pageId = await this.getPageId(spaceKey, folderName);
			log(`Folder: ${folderName}, PageId: ${pageId}`);
			if (!pageId || pageId <= 0) {
				result = await this.createParentPage(
					spaceKey,
					parentPageId,
					folderName
				);

				if (result) {
					pageId = await this.getPageId(spaceKey, folderName);
				} else {
					new Notice(`Failed to create parent page "${folderName}"`);
					return false;
				}
			}

			parentPageId = pageId;
		}

		const version = await this.getPageVersion(spaceKey, fileName);
		if (version > 0) {
			const pageId = await this.getPageId(spaceKey, fileName, false);
			return this.updateMarkdownPage(
				spaceKey,
				parentPageId,
				pageId,
				version,
				fileName,
				content
			);
		} else {
			return this.createMarkdownPage(
				spaceKey,
				parentPageId,
				fileName,
				content
			);
		}
	};

	private createParentPage = async (
		spaceKey: string,
		ancestorId: number,
		title: string
	): Promise<boolean> => {
		const body = `
<ac:structured-macro ac:name="pagetree">
  <ac:parameter ac:name="reverse">false</ac:parameter>
  <ac:parameter ac:name="sort">position</ac:parameter>
  <ac:parameter ac:name="root">
    <ac:link>
      <ri:page ri:content-title="${title}"/>
    </ac:link>
  </ac:parameter>
  <ac:parameter ac:name="startDepth">2</ac:parameter>
  <ac:parameter ac:name="excerpt">false</ac:parameter>
  <ac:parameter ac:name="searchBox">true</ac:parameter>
  <ac:parameter ac:name="expandCollapseAll">true</ac:parameter>
</ac:structured-macro>`;

		return this.createPage(
			spaceKey,
			ancestorId,
			title,
			body
		)
	}

	private createMarkdownPage = async (
		spaceKey: string,
		ancestorId: number,
		title: string,
		content: string
	): Promise<boolean> => {
		const body = `
<ac:structured-macro ac:name="markdown">
  <ac:plain-text-body>
    <![CDATA[\n${content}\n]]>
  </ac:plain-text-body>
</ac:structured-macro>`;

		return this.createPage(
			spaceKey,
			ancestorId,
			title,
			body
		)
	}

	private updateMarkdownPage = async (
		spaceKey: string,
		ancestorId: number,
		pageId: number,
		version: number,
		title: string,
		content: string
	): Promise<boolean> => {
		const body = `
<ac:structured-macro ac:name="markdown">
  <ac:plain-text-body>
    <![CDATA[\n${content}\n]]>
  </ac:plain-text-body>
</ac:structured-macro>`;
		
		return this.updatePage(
			spaceKey,
			ancestorId,
			pageId,
			version,
			title,
			body
		)
	}

	private getPageId = async (
		spaceKey: string,
		title: string,
		cache: boolean = true
	): Promise<number> => {
		let pageId = this.settings.mapping[title] || -1;
		if (pageId <= 0 || !cache) {
			let pageInfo = await this.getPageInfo(spaceKey, title);
			pageId = pageInfo?.id || -1;
			if (pageId > 0) {
				if (cache) {
					this.settings.mapping[title] = pageId;
					await this.saveSettings();
				}
			} else {
				new Notice(`Failed to get root page id for "${title}"`);
			}
		}

		return pageId;
	}

	private getPageVersion = async (
		spaceKey: string,
		title: string
	): Promise<number> => {
		let pageInfo = await this.getPageInfo(spaceKey, title);
		if (pageInfo) {
			let versionInfo = pageInfo?.version;
			return versionInfo?.number || 0;
		}

		return 0;
	}

	private getRelativePath = (
		fullPath: string, 
		rootPageTitle: string
	): string => {
		const re = new RegExp(`${rootPageTitle}(.*)`);
		const match = fullPath.match(re);
		if (match && match.length > 1) {
			return match[1].replace(/^[/\\]+/, "");
		} else {
			return "";
		}
	}

	private getParentFolders = (
		relativePath: string
	): string[] => {
		const parts = relativePath.split(/[/\\]+/);
		if (parts.length <= 1) {
			return [];
		} else {
			return parts.slice(0, parts.length - 1);
		}
	}

	private getFileName = (
		filePath: string, 
		withExt: boolean = false
	): string => {
		const parts = filePath.split(/[/\\]+/);
		const fileName = parts[parts.length - 1];
		return withExt ? fileName : this.stripExtension(fileName);
	}

	private stripExtension = (
		fileName: string
	): string => {
		return fileName.replace(/\.[^/.]+$/, ""); 
	}

	// ---- HTTP API calls ----

	private getPageInfo = async (
		spaceKey: string,
		title: string
	): Promise<any> => {
		// http://192.168.31.103:8090/rest/api/content?spaceKey=~ray&title=知识库&expand=space,body.view,version,container
		const url = `${this.settings.confluenceHost}/rest/api/content?spaceKey=${spaceKey}&title=${encodeURIComponent(title)}&expand=space,body.view,version,container`;
		const res = await this.getHttp(url);

		if (res.status === 200) {
			const data = JSON.parse(res.text);
			if (data.size > 0 && data.results.length > 0) {
				return data.results[0];
			}
		}

		return null;
	}

	private createPage = async (
		spaceKey: string,
		ancestorId: number,
		title: string,
		content: string
	): Promise<boolean> => {
		// http://192.168.31.103:8090/rest/api/content

		const body = {
			type: "page",
			status: "current",
			title: title,
			space: {
				key: spaceKey
			},
			ancestors: [
				{
					id: ancestorId
				}
			],
			body: {
				storage: {
					value: content,
					representation: "storage"
				}
			}
		};
		const jsonBody = JSON.stringify(body);

		const hostUrl = this.settings.confluenceHost;
		const url = `${hostUrl}/rest/api/content`;
		const res = await this.postHttp(url, jsonBody);
		return res.status === 200;
	};

	private updatePage = async (
		spaceKey: string,
		ancestorId: number,
		pageId: number,
		version: number,
		title: string,
		content: string
	): Promise<boolean> => {
		// http://192.168.31.103:8090/rest/api/content/109283151

		const body = {
			type: "page",
			status: "current",
			version: {
				number: version + 1
			},
			title: title,
			space: {
				key: spaceKey
			},
			ancestors: [
				{
					id: ancestorId
				}
			],
			body: {
				storage: {
					value: content,
					representation: "storage"
				}
			}
		};
		const jsonBody = JSON.stringify(body);

		const hostUrl = this.settings.confluenceHost;
		const url = `${hostUrl}/rest/api/content/${pageId}`;
		const res = await this.putHttp(url, jsonBody);
		return res.status === 200;
	};

	private getHttp = async (
		url: string
	): Promise<any> => {
		const options = {
			url: url,
			method: 'GET',
			headers: {
				'Cookie': this.settings.cookie,
				'Accept': 'application/json'
			} as any,
		};
		log(`>>> GET Request: ${url}`);
    	log(JSON.stringify(options, null, 2));

		const res = await requestUrl(options);

		log("<<< GET Response:");
		log(res);

		if (res.status == 200) {
			return res;
		} else {
			throw {
				message: `HTTP Error ${res.status}`,
				statusCode: res.status,
				body: res.text
			};
		}
	}

	private postHttp = async (
		url: string,
		body: any
	): Promise<any> => {
		const options = {
			url: url,
			method: 'POST',
			headers: {
				'Cookie': this.settings.cookie,
				'Accept': 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': 'ObsidianPlugin/0.0.1',
				'X-Content-Type-Options': 'nosniff',
				'X-Atlassian-Token': 'no-check' // 防 CSRF
			} as any,
			body: body,
			throw: false
		};
		log(`>>> POST Request: ${url}`);
		log(JSON.stringify(options, null, 2));

		const res = await requestUrl(options);

		log("<<< POST Response:");
		log(res);

		if (res.status == 200) {
			return res;
		} else {
			throw {
				message: `HTTP Error ${res.status}`,
				statusCode: res.status,
				body: res.text
			};
		}
	}

	private putHttp = async (
		url: string,
		body: any
	): Promise<any> => {
		const options = {
			url: url,
			method: 'PUT',
			headers: {
				'Cookie': this.settings.cookie,
				'Accept': 'application/json',
				'Content-Type': 'application/json',
				'User-Agent': 'ObsidianPlugin/0.0.1',
				'X-Content-Type-Options': 'nosniff',
				'X-Atlassian-Token': 'no-check' // 防 CSRF
			} as any,
			body: body,
			throw: false
		};
		log(`>>> PUT Request: ${url}`);
		log(JSON.stringify(options, null, 2));

		const res = await requestUrl(options);

		log("<<< PUT Response:");
		log(res);

		if (res.status == 200) {
			return res;
		} else {
			throw {
				message: `HTTP Error ${res.status}`,
				statusCode: res.status,
				body: res.text
			};
		}
	}
}

// ---- Settings tab ----

class Publish2ConfluenceSettingTab extends PluginSettingTab {
	plugin: Publish2Confluence;

	constructor(app: App, plugin: Publish2Confluence) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

    new Setting(containerEl)
      .setName("Confluence Host")
      .setDesc("Host URL for Confluence")
      .addText((text) =>
        text
          .setPlaceholder("Confluence Host")
          .setValue(this.plugin.settings.confluenceHost)
          .onChange(async (value) => {
            this.plugin.settings.confluenceHost = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Cookie")
      .setDesc("Get it from browser")
      .addText((text) =>
        text
          .setPlaceholder("Cookie")
          .setValue(this.plugin.settings.cookie)
          .onChange(async (value) => {
            this.plugin.settings.cookie = value;
            await this.plugin.saveSettings();
          })
      );
	
	new Setting(containerEl)
	  .setName("Space Key")
	  .setDesc("Space key to publish under")
	  .addText((text) =>
		text
	  		.setPlaceholder("Space Key")
			.setValue(this.plugin.settings.spaceKey)
			.onChange(async (value) => {
				this.plugin.settings.spaceKey = value;
				await this.plugin.saveSettings();
			})
	  );
	
	new Setting(containerEl)
	  .setName("Root Page Title")
	  .setDesc("Title of the root page to publish under")
	  .addText((text) =>
		text
			.setPlaceholder("Root Page Title")
			.setValue(this.plugin.settings.rootPageTitle)
			.onChange(async (value) => {
				this.plugin.settings.rootPageTitle = value;
				await this.plugin.saveSettings();
			})
	  );
	
	new Setting(containerEl)
	  .setName("Root Folder Path")
	  .setDesc("Path of the root folder to publish from")
	  .addText((text) =>
		text
			.setPlaceholder("Root Folder Path")
			.setValue(this.plugin.settings.rootFolderPath)
			.onChange(async (value) => {
				this.plugin.settings.rootFolderPath = value;
				await this.plugin.saveSettings();
			})
	  );
	}
}

const isDev = process.env.NODE_ENV === "development";
export function log(...args: any[]) {
	if (isDev) {
		console.log(...args);
	}
}