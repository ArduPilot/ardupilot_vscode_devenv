<script lang="ts">
  import { TasksList } from './tasksLists';
  import BoardsList from './lib/BoardsList.svelte';
  import TargetsList from './lib/TargetsList.svelte';
  import ExtraConfig from './lib/ExtraConfig.svelte';
  import FeatureBlock from './lib/FeatureBlock.svelte';
  import "@vscode-elements/elements/dist/vscode-form-container/index.js";
  import "@vscode-elements/elements/dist/vscode-divider/index.js";
  import "@vscode-elements/elements/dist/vscode-button/index.js";
  import "@vscode-elements/elements/dist/vscode-progress-ring/index.js";

  let {vscodeHooks} = $props();
  let board = $state('');
  let target = $state('');
  let extraConfig = $state('');
  let features = $state([]);

  let buildButton: any = $state(null);
  let featuresGroups: { features: any[] }[] = [];
  let tasksList: any = $state(null);

  $effect(() => {
    buildButton?.addEventListener('click', sendBuildRequest);
  });

  async function loadInfo(): Promise<void> {
    const message = await vscodeHooks.request('getTasksList');
    const currentTask = await vscodeHooks.request('getCurrentTask');
    if (currentTask.task) {
      console.log(currentTask.task);
      var task = currentTask.task;
      board = task.configure;
      target = task.target;
      extraConfig = task.configureOptions;
      features = task.features;
    }
    let response = await vscodeHooks.request('getFeaturesList');
    // group features by features.category
    response.featuresList.forEach((feature:any) => {
      const group = featuresGroups.find((group) => group.features[0].category === feature.category);
      if (group) {
        group.features.push(feature);
      } else {
        featuresGroups.push({ features: [feature] });
      }
    });
    tasksList = TasksList.getInstance(message.tasksList);
  }

  function sendBuildRequest() {
    console.log(board, target, extraConfig, features);
    const featureOutput = features.map((feature) => feature);
    vscodeHooks.postMessage('build', {
      board: board,
      target: target,
      extraConfig: extraConfig,
      features: featureOutput
    });
  }
</script>

<main>
  <h1>Build Configuration</h1>
  {#await loadInfo()}
    <vscode-progress-ring>Loading</vscode-progress-ring>
  {:then}
    <BoardsList bind:value={board} boards={tasksList.getBoards()} label="Select Board:" id="board" />
    <TargetsList bind:value={target} targets={tasksList.getTargets(board)} label="Select Target:" id="target"/>
    <ExtraConfig bind:value={extraConfig} id="extraConfig" label="Configure Options:"/>
    <vscode-divider></vscode-divider>
    <h2>Features:</h2>
    <div class = "feature-list">
    {#each featuresGroups as featureGroup}
      <div class="feature-group"><FeatureBlock bind:selected={features} features={featureGroup.features} label="Select Features:"/></div>
    {/each}
    </div>
    <vscode-divider></vscode-divider>
    <vscode-button bind:this={buildButton}>Build</vscode-button>
  {:catch error}
    <p>{error.message}</p>
  {/await}
</main>

<style>
  .feature-list {
    display:flex;
    flex-wrap:wrap;
  }
  .feature-group {
    padding: 5px;
  }
</style>