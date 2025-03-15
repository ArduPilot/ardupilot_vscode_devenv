<script lang="ts">
  import "@vscode-elements/elements/dist/vscode-single-select/index.js";
  import "@vscode-elements/elements/dist/vscode-label/index.js";

  let { value = $bindable(), ...props } = $props();
  let boardSelect: any;

  $effect(() => {
    boardSelect?.addEventListener("change", () => {
      value = boardSelect.value;
    });
  });
</script>

<vscode-label for={props.id}>{props.label}</vscode-label>
<vscode-single-select bind:this={boardSelect} id={props.id}>
  {#each props.boards as board}
    {#if board === value}
      <vscode-option value={board} selected>{board}</vscode-option>
    {:else}
      <vscode-option value={board}>{board}</vscode-option>
    {/if}
  {/each}
</vscode-single-select>
