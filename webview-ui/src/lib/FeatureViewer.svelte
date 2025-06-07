<script lang="ts">
  import "@vscode-elements/elements/dist/vscode-button/index.js";

  let { vscodeHooks, board = "", target = "" } = $props();
  let features = $state<string[]>([]);
  let featureGroups = $state<{category: string, features: any[], enableState: 'all' | 'some' | 'none'}[]>([]);
  let loading = $state(false);
  let error = $state("");
  let featureDefinitions = $state<any[]>([]);

  let extractButton: any = $state(null);

  $effect(() => {
    extractButton?.addEventListener("click", extractFeatures);
    loadFeatureDefinitions();
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

  {#if error}
    <div class="error-message">
      <p>{error}</p>
    </div>
  {/if}

  {#if featureGroups.length > 0}
    <div class="features-list">
      <p class="features-count">{features.length} features found in {featureGroups.length} categories:</p>
      <div class="feature-groups">
        {#each featureGroups as group}
          <div class="feature-group">
            <div class="group-header">
              <div class="group-indicator {group.enableState}"></div>
              <span class="group-title">{group.category} ({group.features.length})</span>
            </div>
            <div class="features-grid">
              {#each group.features as feature}
                <div class="feature-item">
                  <div class="feature-indicator {feature.status}"></div>
                  <span class="feature-name">{getFeatureName(feature.definition)}</span>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {:else if !loading && !error}
    <div class="info-message">
      <p>No features extracted yet. Click "Extract Current Features" to view the features enabled in your build.</p>
    </div>
  {/if}
</div>

<style>
  .feature-viewer {
    margin: 20px 0;
    padding: 10px;
    background-color: var(--vscode-sideBar-background);
    border-radius: 4px;
  }

  .extract-section {
    margin-bottom: 15px;
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
    width: 100%;
    background-color: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 8px;
    box-sizing: border-box;
  }

  .group-header {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
    padding: 4px;
    background-color: var(--vscode-list-inactiveSelectionBackground);
    border-radius: 3px;
  }

  .group-indicator {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    margin-right: 8px;
    flex-shrink: 0;
  }

  .group-indicator.all {
    background-color: #4CAF50; /* Green - all enabled */
  }

  .group-indicator.some {
    background: linear-gradient(45deg, #4CAF50 50%, #757575 50%); /* Half green, half grey */
  }

  .group-indicator.none {
    background-color: #757575; /* Grey - all disabled */
  }

  .group-title {
    font-weight: bold;
    color: var(--vscode-foreground);
    font-size: 0.9em;
    word-wrap: break-word;
    word-break: break-word;
    overflow-wrap: break-word;
    flex: 1;
    line-height: 1.2;
  }

  .features-grid {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px 4px;
    max-height: 280px;
    overflow-y: auto;
    overflow-x: hidden;
    min-height: 60px;
    width: 100%;
    box-sizing: border-box;
  }

  .feature-item {
    display: flex;
    align-items: flex-start;
    padding: 6px 8px;
    border-radius: 3px;
    background-color: var(--vscode-list-inactiveSelectionBackground);
    min-height: 24px;
    width: 100%;
    box-sizing: border-box;
    overflow: hidden;
  }

  .feature-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 8px;
    margin-top: 2px;
    flex-shrink: 0;
  }

  .feature-indicator.enabled {
    background-color: #4CAF50; /* Green */
  }

  .feature-indicator.disabled {
    background-color: #757575; /* Grey */
  }

  .feature-name {
    font-size: 0.85em;
    color: var(--vscode-foreground);
    word-wrap: break-word;
    word-break: break-word;
    overflow-wrap: break-word;
    hyphens: auto;
    line-height: 1.4;
    flex: 1;
    min-width: 0;
    padding-right: 4px;
  }

  h3 {
    margin: 0 0 15px 0;
    color: var(--vscode-foreground);
    font-size: 1.1em;
  }
</style>