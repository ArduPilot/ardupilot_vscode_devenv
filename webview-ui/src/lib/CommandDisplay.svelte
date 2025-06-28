<script lang="ts">
  import "@vscode-elements/elements/dist/vscode-checkbox/index.js";
  import "@vscode-elements/elements/dist/vscode-textarea/index.js";

  let { 
    vscodeHooks, 
    board = "", 
    target = "", 
    featureConfig = "", 
    extraConfig = "",
    overrideEnabled = $bindable(false),
    customConfigureCommand = $bindable(""),
    customBuildCommand = $bindable("")
  } = $props();

  let configureCommand = $state("");
  let buildCommand = $state("");
  let overrideCheckbox: any = $state(null);
  let configureTextArea: any = $state(null);
  let buildTextArea: any = $state(null);

  // Set up event listeners for checkbox and text fields
  $effect(() => {
    if (overrideCheckbox) {
      overrideCheckbox.addEventListener("vsc-change", (e: any) => {
        const wasEnabled = overrideEnabled;
        overrideEnabled = e.detail.checked;
        
        // When enabling override, use current generated commands as initial values
        if (!wasEnabled && overrideEnabled) {
          if (configureCommand && !customConfigureCommand) {
            customConfigureCommand = configureCommand;
          }
          if (buildCommand && !customBuildCommand) {
            customBuildCommand = buildCommand;
          }
        }
      });
    }
  });

  $effect(() => {
    if (configureTextArea) {
      configureTextArea.addEventListener("vsc-change", (e: any) => {
        customConfigureCommand = e.detail.value;
      });
    }
  });

  $effect(() => {
    if (buildTextArea) {
      buildTextArea.addEventListener("vsc-change", (e: any) => {
        customBuildCommand = e.detail.value;
      });
    }
  });

  // Update checkbox state when overrideEnabled changes
  $effect(() => {
    if (overrideCheckbox) {
      overrideCheckbox.checked = overrideEnabled;
    }
  });

  // Update text area values when custom commands change
  $effect(() => {
    if (configureTextArea) {
      configureTextArea.value = customConfigureCommand;
    }
  });

  $effect(() => {
    if (buildTextArea) {
      buildTextArea.value = customBuildCommand;
    }
  });

  // Request build commands whenever configuration changes (only when not overridden)
  $effect(() => {
    if (!overrideEnabled && board && target) {
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
    } else if (!overrideEnabled) {
      configureCommand = "";
      buildCommand = "";
    }
  });

  // Get displayed commands (either generated or custom)
  let displayedConfigureCommand = $derived(overrideEnabled ? customConfigureCommand : configureCommand);
  let displayedBuildCommand = $derived(overrideEnabled ? customBuildCommand : buildCommand);
</script>

<div class="command-section">
  <h3>Commands</h3>
  
  <div class="override-section">
    <vscode-checkbox 
      bind:this={overrideCheckbox}
      checked={overrideEnabled}
    >
      Override commands
    </vscode-checkbox>
  </div>

  <div class="command-group">
    <label>Configure Command:</label>
    {#if overrideEnabled}
      <vscode-textarea 
        bind:this={configureTextArea}
        value={customConfigureCommand}
        placeholder="e.g., python3 ./waf configure --board=sitl --debug"
        rows="1"
        resize="vertical"
        class="command-textarea"
      ></vscode-textarea>
    {:else}
      <div class="command-display">
        <code>{displayedConfigureCommand || "Select board and target to see command"}</code>
      </div>
    {/if}
  </div>

  <div class="command-group">
    <label>Build Command:</label>
    {#if overrideEnabled}
      <vscode-textarea 
        bind:this={buildTextArea}
        value={customBuildCommand}
        placeholder="e.g., python3 ./waf copter --verbose"
        rows="1"
        resize="vertical"
        class="command-textarea"
      ></vscode-textarea>
    {:else}
      <div class="command-display">
        <code>{displayedBuildCommand || "Select board and target to see command"}</code>
      </div>
    {/if}
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

  .override-section {
    margin-bottom: 16px;
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

  .command-textarea {
    width: 100%;
    min-height: 32px;
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    resize: vertical;
  }
</style>