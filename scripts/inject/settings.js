// Settings UI block — Evidence-Gated Knowledge + Research Mode (inserted before RAG section)
const anchor2 = "        // ===== RAG =====";

const settingsBlock = `        // ===== Evidence-Gated Knowledge =====
        containerEl.createEl('h3', { text: '📜 Evidence-Gated Knowledge' });

        new Setting(containerEl)
            .setName('Enable Evidence Gating')
            .setDesc('Block external factual claims without a source from entering the vault (Section 9)')
            .addToggle(t => t.setValue(this.plugin.settings.evidenceGating).onChange(async v => {
                this.plugin.settings.evidenceGating = v;
                await this.plugin.saveSettings();
            }));

        // ===== Research Mode =====
        containerEl.createEl('h3', { text: '🔬 Research Mode' });

        new Setting(containerEl)
            .setName('Enable Research Mode')
            .setDesc('Allow the 13-stage research pipeline (Section 10)')
            .addToggle(t => t.setValue(this.plugin.settings.researchModeEnabled).onChange(async v => {
                this.plugin.settings.researchModeEnabled = v;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('Search Provider')
            .setDesc('DuckDuckGo (zero-config) or SearXNG (user-specified endpoint — self-hosted OR third-party)')
            .addDropdown(d => d
                .addOption('duckduckgo', 'DuckDuckGo (zero-config, no API key)')
                .addOption('searxng', 'SearXNG (user-specified endpoint)')
                .setValue(this.plugin.settings.searchProvider)
                .onChange(async v => {
                    this.plugin.settings.searchProvider = v;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        new Setting(containerEl)
            .setName('SearXNG URL')
            .setDesc('Your SearXNG instance endpoint — self-hosted (e.g. http://localhost:8080) OR third-party (e.g. https://searx.be). Must support /search?format=json. User is responsible for the endpoint.')
            .addText(t => t
                .setPlaceholder('http://localhost:8080')
                .setValue(this.plugin.settings.searxngUrl)
                .setDisabled(this.plugin.settings.searchProvider !== 'searxng')
                .onChange(async v => {
                    this.plugin.settings.searxngUrl = v.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('SearXNG Categories')
            .setDesc('SearXNG search categories (e.g. general, science)')
            .addText(t => t
                .setPlaceholder('general')
                .setValue(this.plugin.settings.searxngCategories)
                .onChange(async v => {
                    this.plugin.settings.searxngCategories = v.trim() || 'general';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Max Sources')
            .setDesc('Maximum number of sources to retrieve and analyze')
            .addSlider(s => s
                .setLimits(1, 20, 1)
                .setValue(this.plugin.settings.maxSources)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.maxSources = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Max Search Results')
            .setDesc('Maximum search results per query')
            .addSlider(s => s
                .setLimits(3, 30, 1)
                .setValue(this.plugin.settings.maxSearchResults)
                .setDynamicTooltip()
                .onChange(async v => {
                    this.plugin.settings.maxSearchResults = v;
                    await this.plugin.saveSettings();
                }));

`;

module.exports = { settingsBlock, anchor2 };