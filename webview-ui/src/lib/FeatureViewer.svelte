<script lang="ts">
  import "@vscode-elements/elements/dist/vscode-button/index.js";
  import "@vscode-elements/elements/dist/vscode-textfield/index.js";

  let { vscodeHooks, board = "", target = "", featureConfig = $bindable("") } = $props();
  let features = $state<string[]>([]);
  let featureGroups = $state<{category: string, features: any[], enableState: 'all' | 'some' | 'none'}[]>([]);
  let loading = $state(false);
  let error = $state("");
  let featureDefinitions = $state<any[]>([]);
  let filterText = $state("");
  let featureStates = $state(new Map()); // Track enable/disable/reset state

  let extractButton: any = $state(null);
  let filterInput: any = $state(null);

  let filteredFeatureGroups = $derived.by(() => {
    if (!filterText.trim()) {
      return featureGroups;
    }

    const searchTerm = filterText.toLowerCase().trim();
    
    return featureGroups
      .map(group => {
        // Filter features within the group
        const filteredFeatures = group.features.filter(feature => {
          const featureName = getFeatureName(feature.definition).toLowerCase();
          const defineName = feature.definition.define.toLowerCase();
          const categoryName = group.category.toLowerCase();
          
          return featureName.includes(searchTerm) || 
                 defineName.includes(searchTerm) ||
                 categoryName.includes(searchTerm);
        });

        // Only include groups that have matching features or matching category name
        if (filteredFeatures.length > 0 || group.category.toLowerCase().includes(searchTerm)) {
          return {
            ...group,
            features: filteredFeatures.length > 0 ? filteredFeatures : group.features,
            enableState: calculateGroupEnableState(filteredFeatures.length > 0 ? filteredFeatures : group.features)
          };
        }
        return null;
      })
      .filter(group => group !== null);
  });

  $effect(() => {
    extractButton?.addEventListener("click", extractFeatures);
    filterInput?.addEventListener("input", () => {
      filterText = filterInput.value;
    });
    loadFeatureDefinitions();
  });

  $effect(() => {
    parseExistingFeatureConfig();
  });

  async function loadFeatureDefinitions() {
    try {
      const response = await vscodeHooks.request("getFeaturesList");
      featureDefinitions = response.featuresList || [];
    } catch (err) {
      console.warn("Could not load feature definitions:", err);
      featureDefinitions = [];
    }
  }

  async function extractFeatures() {
    if (!board || !target) {
      error = "Please select a board and target first";
      return;
    }

    loading = true;
    error = "";
    features = [];
    featureGroups = [];

    try {
      const response = await vscodeHooks.request("extractFeatures", {
        board: board,
        target: target,
      });

      if (response.error) {
        error = response.error;
        features = [];
        featureGroups = [];
      } else {
        features = response.features || [];
        groupFeatures();
        error = "";
      }
    } catch (err) {
      error = `Failed to extract features: ${err}`;
      features = [];
      featureGroups = [];
    } finally {
      loading = false;
    }
  }

  function groupFeatures() {
    if (!features.length || !featureDefinitions.length) {
      featureGroups = [];
      return;
    }

    // Create a map of feature define to feature definition
    const featureDefMap = new Map();
    featureDefinitions.forEach((def: any) => {
      featureDefMap.set(def.define, def);
    });

    // Group features by category
    const groups = new Map();
    
    features.forEach((featureName: string) => {
      const cleanName = featureName.replace(/^!/, '');
      const featureDef = featureDefMap.get(cleanName);
      
      if (featureDef) {
        const category = featureDef.category || 'Other';
        if (!groups.has(category)) {
          groups.set(category, []);
        }
        groups.get(category).push({
          name: featureName,
          definition: featureDef,
          status: getFeatureStatus(featureName)
        });
      } else {
        // For features without definitions, put them in "Other" category
        const category = 'Other';
        if (!groups.has(category)) {
          groups.set(category, []);
        }
        groups.get(category).push({
          name: featureName,
          definition: { define: cleanName, description: cleanName, category: 'Other' },
          status: getFeatureStatus(featureName)
        });
      }
    });

    // Convert map to array and sort by category name
    featureGroups = Array.from(groups.entries())
      .map(([category, features]) => ({ 
        category, 
        features,
        enableState: calculateGroupEnableState(features)
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }

  function calculateGroupEnableState(groupFeatures: any[]): 'all' | 'some' | 'none' {
    const enabledCount = groupFeatures.filter(f => f.status === 'enabled').length;
    
    if (enabledCount === 0) {
      return 'none';
    } else if (enabledCount === groupFeatures.length) {
      return 'all';
    } else {
      return 'some';
    }
  }

  function getFeatureStatus(feature: string): 'enabled' | 'disabled' {
    // Simple logic: if feature starts with '!' or contains 'DISABLE' it's disabled
    if (feature.startsWith('!') || feature.includes('DISABLE')) {
      return 'disabled';
    }
    return 'enabled';
  }

  function getFeatureName(featureDef: any): string {
    // Use description if available, otherwise clean up the define name
    if (featureDef.description && featureDef.description !== featureDef.define) {
      return featureDef.description;
    }
    return featureDef.define.replace(/^AP_/, '').replace(/_/g, ' ');
  }

  function parseExistingFeatureConfig() {
    featureStates.clear();
    
    if (!featureConfig) return;
    
    // Parse existing flags from featureConfig
    const flags = featureConfig.split(/\s+/).filter(flag => flag.trim());
    
    flags.forEach(flag => {
      if (flag.startsWith('--enable-')) {
        const featureName = flag.replace('--enable-', '');
        featureStates.set(featureName, 'enabled');
      } else if (flag.startsWith('--disable-')) {
        const featureName = flag.replace('--disable-', '');
        featureStates.set(featureName, 'disabled');
      }
    });
  }
  
  function getFeatureState(feature: any): 'enabled' | 'disabled' | 'default' {
    // Use the exact label from build_options.py with spaces replaced by hyphens
    if (!feature.label) {
      return 'default';
    }
    const configOption = feature.label.replace(/\s+/g, '-');
    return featureStates.get(configOption) || 'default';
  }
  
  function toggleFeature(feature: any, action: 'enable' | 'disable' | 'reset') {
    // Use the exact label from build_options.py with spaces replaced by hyphens
    const configOption = feature.label.replace(/\s+/g, '-');
    
    if (action === 'reset') {
      featureStates.delete(configOption);
    } else {
      featureStates.set(configOption, action === 'enable' ? 'enabled' : 'disabled');
    }
    
    // Trigger reactivity
    featureStates = new Map(featureStates);
    
    // Generate new feature config string
    updateFeatureConfig();
  }
  
  function updateFeatureConfig() {
    const flags: string[] = [];
    
    featureStates.forEach((state, configOption) => {
      if (state === 'enabled') {
        flags.push(`--enable-${configOption}`);
      } else if (state === 'disabled') {
        flags.push(`--disable-${configOption}`);
      }
    });
    
    featureConfig = flags.join(' ');
  }
  
  function bulkToggleCategory(category: string, action: 'enable' | 'disable' | 'reset') {
    // Find features in this category from featureDefinitions
    const categoryFeatures = featureDefinitions.filter(f => f.category === category);
    
    categoryFeatures.forEach(feature => {
      toggleFeature(feature, action);
    });
  }
</script>

<div class="feature-viewer">
  <h3>Current Features</h3>
  
  <div class="extract-section">
    <vscode-button bind:this={extractButton} disabled={loading || !board || !target}>
      {loading ? "Extracting..." : "Extract Current Features"}
    </vscode-button>
    
    {#if !board || !target}
      <p class="info-text">Please select a board and target to extract features</p>
    {/if}
  </div>

  {#if featureGroups.length > 0}
    <div class="filter-section">
      <vscode-textfield 
        bind:this={filterInput}
        placeholder="Filter features by name, category, or define..."
        class="filter-input"
      ></vscode-textfield>
    </div>
  {/if}

  {#if error}
    <div class="error-message">
      <p>{error}</p>
    </div>
  {/if}

  {#if featureGroups.length > 0}
    <div class="features-list">
      <p class="features-count">
        {#if filterText}
          Showing {filteredFeatureGroups.reduce((sum, g) => sum + g.features.length, 0)} of {features.length} features in {filteredFeatureGroups.length} categories
        {:else}
          {features.length} features found in {featureGroups.length} categories:
        {/if}
      </p>
      <div class="feature-groups">
        {#each filteredFeatureGroups as group}
          <div class="feature-group">
            <div class="group-header">
              <div class="group-indicator {group.enableState}"></div>
              <span class="group-title">{group.category} ({group.features.length})</span>
              <div class="group-controls">
                <vscode-button 
                  role="button"
                  tabindex="0"
                  class="control-button enable-button"
                  title="Enable all features in {group.category}"
                  onclick={() => bulkToggleCategory(group.category, 'enable')}
                  onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bulkToggleCategory(group.category, 'enable'); } }}
                >+</vscode-button>
                <vscode-button 
                  role="button"
                  tabindex="0"
                  class="control-button disable-button" 
                  title="Disable all features in {group.category}"
                  onclick={() => bulkToggleCategory(group.category, 'disable')}
                  onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bulkToggleCategory(group.category, 'disable'); } }}
                >-</vscode-button>
                <vscode-button 
                  role="button"
                  tabindex="0"
                  class="control-button reset-button"
                  title="Reset all features in {group.category} to defaults"
                  onclick={() => bulkToggleCategory(group.category, 'reset')}
                  onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); bulkToggleCategory(group.category, 'reset'); } }}
                >↻</vscode-button>
              </div>
            </div>
            <div class="features-grid">
              {#each group.features as feature}
                <div class="feature-item">
                  <div class="feature-indicator {feature.status}"></div>
                  <span class="feature-name">{getFeatureName(feature.definition)}</span>
                  <div class="feature-controls">
                    <vscode-button 
                      role="button"
                      tabindex="0"
                      class="control-button enable-button {getFeatureState(feature.definition) === 'enabled' ? 'active' : ''}"
                      title="Enable {getFeatureName(feature.definition)}"
                      onclick={() => toggleFeature(feature.definition, 'enable')}
                      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFeature(feature.definition, 'enable'); } }}
                    >+</vscode-button>
                    <vscode-button 
                      role="button"
                      tabindex="0"
                      class="control-button disable-button {getFeatureState(feature.definition) === 'disabled' ? 'active' : ''}"
                      title="Disable {getFeatureName(feature.definition)}"
                      onclick={() => toggleFeature(feature.definition, 'disable')}
                      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFeature(feature.definition, 'disable'); } }}
                    >-</vscode-button>
                    <vscode-button 
                      role="button"
                      tabindex="0"
                      class="control-button reset-button {getFeatureState(feature.definition) === 'default' ? 'active' : ''}"
                      title="Reset {getFeatureName(feature.definition)} to default"
                      onclick={() => toggleFeature(feature.definition, 'reset')}
                      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFeature(feature.definition, 'reset'); } }}
                    >↻</vscode-button>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {:else}
          {#if filterText}
            <div class="no-results">
              <p>No features match "{filterText}"</p>
            </div>
          {/if}
        {/each}
      </div>
    </div>
  {:else if !loading && !error}
    <div class="info-message">
      <p>No features extracted yet. Click "Extract Current Features" to view and available feature configurations.</p>
    </div>
  {/if}
</div>

<style>
  .feature-viewer {
    --feature-enabled-color: var(--vscode-terminal-ansiGreen);
    --feature-disabled-color: var(--vscode-disabledForeground);
    --feature-error-color: var(--vscode-errorForeground);
    
    margin: 20px 0;
    padding: 10px;
    background-color: var(--vscode-sideBar-background);
    border-radius: 4px;
  }

  .extract-section {
    margin-bottom: 15px;
  }

  .filter-section {
    margin-bottom: 15px;
  }

  .filter-input {
    width: 100%;
  }

  .info-text {
    color: var(--vscode-descriptionForeground);
    font-size: 0.9em;
    margin-top: 5px;
    margin-bottom: 0;
  }

  .error-message {
    background-color: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    color: var(--vscode-inputValidation-errorForeground);
    padding: 10px;
    margin: 10px 0;
    border-radius: 4px;
  }

  .error-message p {
    margin: 0;
  }

  .info-message {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    margin: 15px 0;
  }

  .info-message p {
    margin: 0;
  }

  .no-results {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    text-align: center;
    padding: 20px;
  }

  .no-results p {
    margin: 0;
  }

  .features-count {
    font-weight: bold;
    margin-bottom: 10px;
    color: var(--vscode-foreground);
  }

  .feature-groups {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
    margin-top: 10px;
  }

  .feature-group {
    background-color: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 12px;
  }

  .group-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    padding: 4px;
    background-color: var(--vscode-list-inactiveSelectionBackground);
    border-radius: 3px;
  }

  .group-controls {
    display: flex;
    gap: 1px;
    align-items: center;
  }

  .group-indicator {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    margin-right: 8px;
    flex-shrink: 0;
  }

  .group-indicator.all {
    background-color: var(--feature-enabled-color);
  }

  .group-indicator.some {
    background: linear-gradient(45deg, var(--feature-enabled-color) 50%, var(--feature-disabled-color) 50%);
  }

  .group-indicator.none {
    background-color: var(--feature-disabled-color);
  }

  .group-title {
    font-weight: bold;
    color: var(--vscode-foreground);
    font-size: 0.9em;
    overflow-wrap: break-word;
    flex: 1;
    line-height: 1.2;
  }

  .features-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 16px;
    max-height: 280px;
    min-height: 60px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: var(--vscode-scrollbarSlider-background) var(--vscode-scrollbar-shadow);
  }

  .features-grid::-webkit-scrollbar {
    width: 10px;
  }
  
  .features-grid::-webkit-scrollbar-track {
    background: transparent;
  }
  
  .features-grid::-webkit-scrollbar-thumb {
    background: var(--vscode-scrollbarSlider-background);
    border-radius: 4px;
    border: 2px solid transparent;
    background-clip: padding-box;
  }
  
  .features-grid::-webkit-scrollbar-thumb:hover {
    background: var(--vscode-scrollbarSlider-hoverBackground);
  }

  .feature-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 4px;
    border-radius: 3px;
    background-color: var(--vscode-list-inactiveSelectionBackground);
  }

  .feature-controls {
    display: flex;
    gap: 1px;
    align-items: center;
    margin-top: 2px;
  }

  .feature-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin: 4px 10px 0 0;
    flex-shrink: 0;
  }

  .feature-indicator.enabled {
    background-color: var(--feature-enabled-color);
  }

  .feature-indicator.disabled {
    background-color: var(--feature-disabled-color);
  }

  .feature-name {
    font-size: 0.85em;
    color: var(--vscode-foreground);
    overflow-wrap: break-word;
    line-height: 1.4;
    flex: 1;
    min-width: 0;
    padding: 0 8px;
  }

  .control-button {
    width: 18px;
    height: 18px;
    font-size: 12px;
    border-radius: 3px;
    margin: 0 2px;
    background: transparent;
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .control-button:hover {
    background-color: var(--vscode-toolbar-hoverBackground);
  }

  .control-button.enable-button {
    color: var(--feature-enabled-color);
  }

  .control-button.disable-button {
    color: var(--feature-error-color);
  }

  .control-button.reset-button {
    color: var(--vscode-descriptionForeground);
  }

  .control-button.active.enable-button {
    background-color: color-mix(in srgb, var(--feature-enabled-color) 20%, transparent);
    color: var(--feature-enabled-color);
  }

  .control-button.active.disable-button {
    background-color: color-mix(in srgb, var(--feature-error-color) 20%, transparent);
    color: var(--feature-error-color);
  }


  h3 {
    margin: 0 0 15px 0;
    color: var(--vscode-foreground);
    font-size: 1.1em;
  }
</style>