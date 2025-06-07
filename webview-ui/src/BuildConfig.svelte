<script lang="ts">
  import { TasksList } from "./tasksLists";
  import BoardsList from "./lib/BoardsList.svelte";
  import TargetsList from "./lib/TargetsList.svelte";
  import ExtraConfig from "./lib/ExtraConfig.svelte";
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

  async function loadInfo(): Promise<void> {
    const message = await vscodeHooks.request("getTasksList");
    const currentTask = await vscodeHooks.request("getCurrentTask");
    if (currentTask.task) {
      console.log(currentTask.task);
      var task = currentTask.task;
      board = task.configure;
      target = task.target;
      extraConfig = task.configureOptions;
      simVehicleCommand = task.simVehicleCommand || "";
      isEditMode = true;
    } else {
      isEditMode = false;
    }
    tasksList = TasksList.getInstance(message.tasksList);
  }


  function sendBuildRequest() {
    console.log(board, target, extraConfig);
    vscodeHooks.postMessage("build", {
      board: board,
      target: target,
      extraConfig: extraConfig,
      simVehicleCommand: simVehicleCommand,
    });
  }

  function switchToAddMode() {
    // Clear all selections and switch to add mode
    board = "";
    target = "";
    extraConfig = "";
    simVehicleCommand = "";
    isEditMode = false;

    // Notify the backend that we want to switch to add mode
    vscodeHooks.postMessage("switchToAddMode", {});
  }


  function isSitlBoard(): boolean {
    return board.toLowerCase() === "sitl";
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
      {#if isSitlBoard()}
        <SITLConfig
          bind:value={simVehicleCommand}
          id="sitlConfig"
          label="SITL Command:"
        />
      {/if}
      <ExtraConfig
        bind:value={extraConfig}
        id="extraConfig"
        label="Configure Options:"
      />
      <vscode-divider></vscode-divider>

      <FeatureViewer {vscodeHooks} {board} {target} />
      <vscode-divider></vscode-divider>
      <vscode-button bind:this={buildButton}
        >Save Configuration & Build</vscode-button
      >
    {/await}
  </ErrorBoundary>
</main>

<style>
  /* Main styles moved to components */
</style>
