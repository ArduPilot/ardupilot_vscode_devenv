<script lang="ts">
  import { TasksList } from "./tasksLists";
  import BoardsList from "./lib/BoardsList.svelte";
  import TargetsList from "./lib/TargetsList.svelte";
  import ConfigName from "./lib/ConfigName.svelte";
  import ExtraConfig from "./lib/ExtraConfig.svelte";
  import FeatureConfig from "./lib/FeatureConfig.svelte";
  import SITLConfig from "./lib/SITLConfig.svelte";
  import FeatureViewer from "./lib/FeatureViewer.svelte";
  import ErrorBoundary from "./lib/ErrorBoundary.svelte";
  import "@vscode-elements/elements/dist/vscode-form-container/index.js";
  import "@vscode-elements/elements/dist/vscode-divider/index.js";
  import "@vscode-elements/elements/dist/vscode-button/index.js";
  import "@vscode-elements/elements/dist/vscode-progress-ring/index.js";

  let { vscodeHooks } = $props();
  let board = $state("");
  let target = $state("");
  let configName = $state("");
  let featureConfig = $state("");
  let extraConfig = $state("");
  let simVehicleCommand = $state("");
  let isEditMode = $state(false);

  let buildButton: any = $state(null);
  let addNewButton: any = $state(null);
  let tasksList: any = $state(null);

  $effect(() => {
    buildButton?.addEventListener("click", sendBuildRequest);
    addNewButton?.addEventListener("click", switchToAddMode);
  });

  // Auto-generate config name when board/target change (only in add mode)
  $effect(() => {
    if (!isEditMode && board && target) {
      generateConfigName();
    }
  });

  async function loadInfo(): Promise<void> {
    const message = await vscodeHooks.request("getTasksList");
    const currentTask = await vscodeHooks.request("getCurrentTask");
    if (currentTask.task) {
      console.log(currentTask.task);
      var task = currentTask.task;
      board = task.configure;
      target = task.target;
      configName = task.configName;
      // Parse existing configureOptions to separate feature flags from extra config
      const options = task.configureOptions || "";
      const parts = parseConfigOptions(options);
      featureConfig = parts.featureConfig;
      extraConfig = parts.extraConfig;
      simVehicleCommand = task.simVehicleCommand || "";
      isEditMode = true;
    } else {
      isEditMode = false;
    }
    tasksList = TasksList.getInstance(message.tasksList);
  }


  function sendBuildRequest() {
    // Combine feature config and extra config
    const combinedConfig = [featureConfig, extraConfig]
      .filter(config => config.trim())
      .join(' ');
    
    console.log(board, target, configName, combinedConfig);
    vscodeHooks.postMessage("build", {
      board: board,
      target: target,
      configName: configName,
      extraConfig: combinedConfig,
      simVehicleCommand: simVehicleCommand,
    });
  }

  function switchToAddMode() {
    // Clear all selections and switch to add mode
    board = "";
    target = "";
    configName = "";
    featureConfig = "";
    extraConfig = "";
    simVehicleCommand = "";
    isEditMode = false;

    // Notify the backend that we want to switch to add mode
    vscodeHooks.postMessage("switchToAddMode", {});
  }

  async function generateConfigName() {
    if (board && target) {
      const baseName = `${board}-${target}`;
      
      // Get existing configuration names
      const existingNames = await getExistingConfigNames();
      
      // Check if base name already exists
      if (!existingNames.includes(baseName)) {
        configName = baseName;
        return;
      }
      
      // Find the next available number
      let counter = 2;
      let candidateName = `${baseName}-${counter}`;
      
      while (existingNames.includes(candidateName)) {
        counter++;
        candidateName = `${baseName}-${counter}`;
      }
      
      configName = candidateName;
    }
  }
  
  async function getExistingConfigNames(): Promise<string[]> {
    try {
      const response = await vscodeHooks.request("getExistingConfigNames");
      return response.configNames || [];
    } catch (error) {
      console.error("Failed to get existing config names:", error);
      return [];
    }
  }


  function isSitlBoard(): boolean {
    return board.toLowerCase() === "sitl";
  }

  function parseConfigOptions(options: string): { featureConfig: string, extraConfig: string } {
    if (!options.trim()) {
      return { featureConfig: "", extraConfig: "" };
    }
    
    const parts = options.split(/\s+/).filter(part => part.trim());
    const featureFlags: string[] = [];
    const otherOptions: string[] = [];
    
    parts.forEach(part => {
      if (part.startsWith('--enable-') || part.startsWith('--disable-')) {
        featureFlags.push(part);
      } else {
        otherOptions.push(part);
      }
    });
    
    return {
      featureConfig: featureFlags.join(' '),
      extraConfig: otherOptions.join(' ')
    };
  }


  // Add a function to handle errors better
  function handleError(detail: { error: Error | null; originalStack: string; enhancedStack?: string; location?: string }) {
    if (detail.error) {
      console.error("Error caught by boundary:", detail.error, "at", detail.location);
      vscodeHooks.postMessage("error", {
        message: detail.error.message,
        stack: detail.enhancedStack || detail.originalStack,
        location: detail.location || "BuildConfig",
      });
    } else {
      console.error("Error caught by boundary with no error object:", detail);
      vscodeHooks.postMessage("error", {
        message: "Unknown error in ErrorBoundary",
        stack: detail.enhancedStack || detail.originalStack,
        location: detail.location || "BuildConfig",
      });
    }
  }
</script>

<main>
  <ErrorBoundary onerror={handleError}>
    {#await loadInfo()}
      <vscode-progress-ring>Loading</vscode-progress-ring>
    {:then}
      <h1>
        {isEditMode
          ? "Edit Build Configuration"
          : "Create a new build configuration"}
      </h1>
      <BoardsList
        bind:value={board}
        boards={tasksList.getBoards()}
        label="Select Board:"
        id="board"
        {vscodeHooks}
      />
      <TargetsList
        bind:value={target}
        targets={tasksList.getTargets(board)}
        label="Select Target:"
        id="target"
      />
      <ConfigName
        bind:value={configName}
        label="Configuration Name:"
        id="configName"
      />
      {#if isSitlBoard()}
        <SITLConfig
          bind:value={simVehicleCommand}
          id="sitlConfig"
          label="SITL Command:"
        />
      {/if}
      <FeatureConfig
        bind:value={featureConfig}
        id="featureConfig"
        label="Feature Configuration:"
      />
      <ExtraConfig
        bind:value={extraConfig}
        id="extraConfig"
        label="Additional Configure Options:"
      />

      <vscode-divider style="visibility: hidden;"></vscode-divider>
      <vscode-button bind:this={buildButton} class="build-button">
        Save Configuration & Build
      </vscode-button>
      <vscode-divider style="visibility: hidden;"></vscode-divider>

      <FeatureViewer {vscodeHooks} {board} {target} bind:featureConfig={featureConfig} />
      <vscode-divider></vscode-divider>
    {/await}
  </ErrorBoundary>
</main>

<style>
  main {
    padding-bottom: 40px;
  }
  
  .build-button {
    margin-bottom: 30px;
  }
</style>
