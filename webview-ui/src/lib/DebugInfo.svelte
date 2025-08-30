<script lang="ts">
  let { 
    vscodeHooks,
    board = "", 
    target = ""
  } = $props();

  let debugInfo: any = $state(null);
  let loading = $state(false);

  // Request debug info whenever board changes (target is not relevant for hardware debug info)
  $effect(() => {
    if (board && board.toLowerCase() !== 'sitl') {
      loading = true;
      vscodeHooks.request("getDebugInfo", {
        board: board,
        target: target
      }).then((response: any) => {
        debugInfo = response.debugInfo;
        loading = false;
      }).catch((error: any) => {
        console.error("Failed to get debug info:", error);
        debugInfo = null;
        loading = false;
      });
    } else {
      debugInfo = null;
      loading = false;
    }
  });

  // Helper function to check if we should show debug info
  function shouldShowDebugInfo(): boolean {
    return board && board.toLowerCase() !== 'sitl';
  }
</script>

{#if shouldShowDebugInfo()}
  <div class="debug-section">
    <h3>Hardware Debug Information</h3>
    
    {#if loading}
      <div class="loading">Loading debug information...</div>
    {:else if debugInfo}
      <div class="debug-info-grid">
        <div class="info-item">
          <span class="label">MCU Target:</span>
          <span class="value">{debugInfo.mcuTarget || 'Unknown'}</span>
        </div>
        {#if debugInfo.flashSizeKB}
        <div class="info-item">
          <span class="label">Flash Size:</span>
          <span class="value">{debugInfo.flashSizeKB}KB</span>
        </div>
        {/if}
        <div class="info-item">
          <span class="label">OpenOCD Target:</span>
          <span class="value">{debugInfo.openocdTarget || 'Not available'}</span>
        </div>
        <div class="info-item">
          <span class="label">JLink Device:</span>
          <span class="value">{debugInfo.jlinkDevice || 'Not available'}</span>
        </div>
        <div class="info-item">
          <span class="label">SVD File:</span>
          <span class="value">{debugInfo.svdFile || 'Not available'}</span>
        </div>
      </div>
    {:else}
      <div class="no-debug-info">
        No debug information available for this board. This may be because:
        <ul>
          <li>The board's hwdef.dat file was not found</li>
          <li>The MCU target is not supported</li>
          <li>The board configuration is incomplete</li>
        </ul>
      </div>
    {/if}
  </div>
{/if}

<style>
  .debug-section {
    margin: 16px 0;
    padding: 12px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: var(--vscode-editor-background);
  }

  .debug-section h3 {
    margin: 0 0 12px 0;
    color: var(--vscode-foreground);
    font-size: 14px;
    font-weight: 600;
  }

  .loading {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    padding: 8px 0;
  }

  .debug-info-grid {
    display: grid;
    gap: 8px;
  }

  .info-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0;
    border-bottom: 1px solid var(--vscode-widget-border);
  }

  .info-item:last-child {
    border-bottom: none;
  }

  .label {
    font-weight: 500;
    color: var(--vscode-foreground);
    min-width: 120px;
    font-size: 12px;
  }

  .value {
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
    text-align: right;
    word-break: break-word;
    max-width: 60%;
  }

  .no-debug-info {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    line-height: 1.4;
  }

  .no-debug-info ul {
    margin: 8px 0 0 16px;
    padding: 0;
  }

  .no-debug-info li {
    margin: 4px 0;
  }
</style>