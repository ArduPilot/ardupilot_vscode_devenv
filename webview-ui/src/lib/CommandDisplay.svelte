<script lang="ts">
  let { 
    vscodeHooks, 
    board = "", 
    target = "", 
    featureConfig = "", 
    extraConfig = "" 
  } = $props();

  let configureCommand = $state("");
  let buildCommand = $state("");

  // Request build commands whenever configuration changes
  $effect(() => {
    if (board && target) {
      const combinedConfig = [featureConfig, extraConfig]
        .filter(config => config.trim())
        .join(' ');
      
      vscodeHooks.request("getBuildCommands", {
        board: board,
        target: target,
        configureOptions: combinedConfig
      }).then((response: any) => {
        configureCommand = response.configureCommand || "";
        buildCommand = response.buildCommand || "";
      }).catch((error: any) => {
        console.error("Failed to get build commands:", error);
        configureCommand = "";
        buildCommand = "";
      });
    } else {
      configureCommand = "";
      buildCommand = "";
    }
  });
</script>

<div class="command-section">
  <h3>Commands</h3>
  
  <div class="command-group">
    <label>Configure Command:</label>
    <div class="command-display">
      <code>{configureCommand || "Select board and target to see command"}</code>
    </div>
  </div>

  <div class="command-group">
    <label>Build Command:</label>
    <div class="command-display">
      <code>{buildCommand || "Select board and target to see command"}</code>
    </div>
  </div>
</div>

<style>
  .command-section {
    margin: 16px 0;
  }

  .command-section h3 {
    margin: 0 0 12px 0;
    color: var(--vscode-foreground);
    font-size: 14px;
    font-weight: 600;
  }

  .command-group {
    margin-bottom: 12px;
  }

  .command-group label {
    display: block;
    margin-bottom: 4px;
    color: var(--vscode-foreground);
    font-size: 12px;
    font-weight: 500;
  }

  .command-display {
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-input-border);
    border-radius: 2px;
    padding: 8px;
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .command-display code {
    color: var(--vscode-editor-foreground);
    background: transparent;
    font-family: inherit;
    white-space: pre-wrap;
  }
</style>