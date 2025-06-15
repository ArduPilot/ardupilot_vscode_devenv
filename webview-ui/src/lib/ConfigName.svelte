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

	// Update the textfield value when the prop value changes
	$effect(() => {
		if (textField && value !== undefined) {
			textField.value = value;
		}
	});
</script>

<vscode-label for={props.id}>{props.label}</vscode-label>
<vscode-textfield bind:this={textField} id={props.id} type="text" placeholder="Enter configuration name..."
></vscode-textfield>