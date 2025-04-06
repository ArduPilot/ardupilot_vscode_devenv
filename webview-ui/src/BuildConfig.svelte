<script lang="ts">
  import { TasksList } from "./tasksLists";
  import BoardsList from "./lib/BoardsList.svelte";
  import TargetsList from "./lib/TargetsList.svelte";
  import ExtraConfig from "./lib/ExtraConfig.svelte";
  import SITLConfig from "./lib/SITLConfig.svelte";
  import FeatureBlock from "./lib/FeatureBlock.svelte";
  import "@vscode-elements/elements/dist/vscode-form-container/index.js";
  import "@vscode-elements/elements/dist/vscode-divider/index.js";
  import "@vscode-elements/elements/dist/vscode-button/index.js";
  import "@vscode-elements/elements/dist/vscode-progress-ring/index.js";
  import "@vscode-elements/elements/dist/vscode-checkbox/index.js";

  let { vscodeHooks } = $props();
  let board = $state("");
  let target = $state("");
  let extraConfig = $state("");
  let simVehicleCommand = $state("");
  let features = $state([]);
  let isEditMode = $state(false);
  let enableFeatureConfig = $state(false);
  let featuresLoaded = $state(false);

  let buildButton: any = $state(null);
  let addNewButton: any = $state(null);
  let featuresGroups: { features: any[] }[] = [];
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
      features = task.features || [];
      enableFeatureConfig = task.enableFeatureConfig;
      isEditMode = true;
    } else {
      isEditMode = false;
    }
    tasksList = TasksList.getInstance(message.tasksList);
  }

  async function loadFeatures(): Promise<void> {
    if (featuresLoaded) return;

    let response = await vscodeHooks.request("getFeaturesList");
    // group features by features.category
    response.featuresList.forEach((feature: any) => {
      const group = featuresGroups.find(
        (group) => group.features[0].category === feature.category,
      );
      if (group) {
        group.features.push(feature);
      } else {
        featuresGroups.push({ features: [feature] });
      }
    });
    featuresLoaded = true;
  }

  function sendBuildRequest() {
    console.log(board, target, extraConfig, features);
    const featureOutput = enableFeatureConfig
      ? features.map((feature) => feature)
      : [];
    vscodeHooks.postMessage("build", {
      board: board,
      target: target,
      extraConfig: extraConfig,
      simVehicleCommand: simVehicleCommand,
      features: featureOutput,
      enableFeatureConfig: enableFeatureConfig,
    });
  }

  function switchToAddMode() {
    // Clear all selections and switch to add mode
    board = "";
    target = "";
    extraConfig = "";
    simVehicleCommand = "";
    features = [];
    isEditMode = false;

    // Notify the backend that we want to switch to add mode
    vscodeHooks.postMessage("switchToAddMode", {});
  }

  function toggleFeatures() {
    if (enableFeatureConfig && !featuresLoaded) {
      loadFeatures();
    }
  }

  function handleFeatureToggle(event: Event) {
    enableFeatureConfig = (event.target as HTMLInputElement).checked;
    toggleFeatures();
  }

  function isSitlBoard(): boolean {
    return board.toLowerCase() === "sitl";
  }

  $effect(() => {
    toggleFeatures();
  });
</script>

<main>
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

    <div class="feature-toggle">
      <vscode-checkbox
        id="enable-features-checkbox"
        onchange={handleFeatureToggle}
        checked={enableFeatureConfig}>Enable Feature Config</vscode-checkbox
      >
    </div>

    {#if enableFeatureConfig}
      <h2>Features:</h2>
      {#await loadFeatures() then}
        {#if features.length === 0}
          <div class="info-message">
            <p>
              No features loaded. Please Save Configuration & Build firmware to
              extract initial features.
            </p>
          </div>
        {:else}
          <div class="feature-list">
            {#each featuresGroups as featureGroup}
              <div class="feature-group">
                <FeatureBlock
                  bind:selected={features}
                  featureGroups={featuresGroups}
                  features={featureGroup.features}
                  label="Select Features:"
                />
              </div>
            {/each}
          </div>
        {/if}
      {/await}
    {/if}
    <vscode-divider></vscode-divider>
    <vscode-button bind:this={buildButton}
      >Save Configuration & Build</vscode-button
    >
  {:catch error}
    <p>{error.message}</p>
  {/await}
</main>

<style>
  .feature-list {
    display: flex;
    flex-wrap: wrap;
  }
  .feature-group {
    padding: 5px;
  }
  .feature-toggle {
    margin: 10px 0;
  }
  .info-message {
    margin: 10px 0;
    color: #666;
  }
</style>
