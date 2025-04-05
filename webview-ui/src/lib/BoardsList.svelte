<script lang="ts">
  import "@vscode-elements/elements/dist/vscode-single-select/index.js";
  import "@vscode-elements/elements/dist/vscode-label/index.js";

  let { value = $bindable(), vscodeHooks, ...props } = $props();
  let boardSelect: any;
  let previousValue = "";

  $effect(() => {
    boardSelect?.addEventListener("change", () => {
      const newValue = boardSelect.value;
      value = newValue;

      // Only notify when value actually changes to avoid unnecessary events
      if (newValue !== previousValue && newValue && vscodeHooks) {
        vscodeHooks.postMessage("boardSelected", { board: newValue });
        previousValue = newValue;
      }
    });
  });
</script>

<vscode-label for={props.id}>{props.label}</vscode-label>
<vscode-single-select bind:this={boardSelect} id={props.id} combobox>
  {#each props.boards as board}
    {#if board === value}
      <vscode-option value={board} selected>{board}</vscode-option>
    {:else}
      <vscode-option value={board}>{board}</vscode-option>
    {/if}
  {/each}
</vscode-single-select>
