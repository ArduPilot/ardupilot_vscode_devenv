<!-- filepath: /home/sidbh/Programming/ardupilot_vscode_devenv/webview-ui/src/lib/SITLConfig.svelte -->
<script lang="ts">
	import "@vscode-elements/elements/dist/vscode-textfield/index.js";
	import "@vscode-elements/elements/dist/vscode-label/index.js";

	let { value = $bindable(), ...props } = $props();

	let textField: any = $state(null);

	$effect(() => {
		textField?.addEventListener("change", () => {
			value = textField.value;
		});
	});
</script>

<vscode-label for={props.id}>{props.label}</vscode-label>
<vscode-textfield
	bind:this={textField}
	id={props.id}
	type="text"
	placeholder="e.g: -v --console"
></vscode-textfield>
