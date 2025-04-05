<!-- collapsible block with checkboxes -->
<script lang="ts">
	import "@vscode-elements/elements/dist/vscode-collapsible/index.js";
	import "@vscode-elements/elements/dist/vscode-checkbox/index.js";
	let {
		selected = $bindable(),
		featureGroups,
		features,
		...props
	} = $props();

	let checkbox: { [feature: string]: any } = $state({});
	let mainCheckbox: any = $state(null);

	// Tracks which features are disabled due to dependency issues
	let disabledByDependency: { [feature: string]: boolean } = $state({});

	// Helper function to check if a feature should be disabled based on its dependencies
	function checkDependencies(feature: any): boolean {
		if (!feature.dependency) {
			return false;
		}

		// Parse comma-separated dependencies
		const dependencies = feature.dependency
			.split(",")
			.map((d: string) => d.trim());

		// Check if any dependency is disabled (has a ! prefix in the selected array)
		console.log(
			`Checking dependencies for ${feature.label}: ${dependencies}`,
		);
		// print list of all features
		console.log("All features: ", featureGroups);
		for (const dep of dependencies) {
			let depFeature: any = null;
			featureGroups.forEach((group: any) => {
				group.features.forEach((f: any) => {
					if (f.label === dep) {
						depFeature = f;
						console.log("Dependency found: ", f);
					}
				});
			});
			console.log(
				`Checking dependency ${dep} for feature ${feature.label}: ${depFeature}`,
			);
			if (dep && selected.includes(`!${depFeature.define}`)) {
				return true;
			}
		}

		return false;
	}

	// Function to update the disabled status of all features based on dependencies
	function updateDisabledStatus() {
		for (const feature of features) {
			const featureName = feature.define;
			const shouldBeDisabled = checkDependencies(feature);

			disabledByDependency[featureName] = shouldBeDisabled;

			// If checkbox exists and feature should be disabled due to dependencies
			if (checkbox[featureName] && shouldBeDisabled) {
				// Disable the checkbox
				checkbox[featureName].disabled = true;

				// If it was checked, uncheck it and add to the disabled list
				if (checkbox[featureName].checked) {
					checkbox[featureName].checked = false;

					// Update selected list to reflect this feature is now disabled
					selected = selected.filter(
						(item: string) => item !== featureName,
					);
					if (!selected.includes(`!${featureName}`)) {
						selected = [...selected, `!${featureName}`];
					}
				}
			} else if (checkbox[featureName]) {
				// Re-enable the checkbox if dependency issue is resolved
				checkbox[featureName].disabled = shouldBeDisabled;
			}
		}
	}

	$effect(() => {
		// When selected array changes, update disabled status
		updateDisabledStatus();
	});

	$effect(() => {
		Object.keys(checkbox).forEach((key) => {
			checkbox[key].addEventListener("change", () => {
				if (checkbox[key].checked) {
					selected = selected.filter(
						(item: string) => item !== `!${key}`,
					);
					selected = [...selected, key];
				} else {
					selected = selected.filter((item: string) => item !== key);
					selected = [...selected, `!${key}`];
				}
				console.log(selected);
				// check if all checkboxes are checked
				var mainCheckbox = document.getElementById(
					features[0].category,
				);
				if (mainCheckbox) {
					if (selected.length === features.length) {
						(mainCheckbox as HTMLInputElement).checked = true;
					} else if (selected.length === 0) {
						(mainCheckbox as HTMLInputElement).checked = false;
					} else {
						(mainCheckbox as HTMLInputElement).indeterminate = true;
					}
					// Update dependency disabled status after selection changes
					updateDisabledStatus();
				}
			});
		});
	});

	function updateMainCheckbox(mainCheckbox: any) {
		let selectedFiltered: string[] = [];
		for (const feature of features) {
			if (selected.includes(feature.define)) {
				selectedFiltered = [...selectedFiltered, feature.define];
			}
		}
		// check if all features in the selected list
		if (selectedFiltered.length === features.length) {
			(mainCheckbox as HTMLInputElement).checked = true;
			(mainCheckbox as HTMLInputElement).indeterminate = false;
		} else if (selectedFiltered.length === 0) {
			(mainCheckbox as HTMLInputElement).checked = false;
			(mainCheckbox as HTMLInputElement).indeterminate = false;
		} else {
			(mainCheckbox as HTMLInputElement).indeterminate = true;
		}
	}

	$effect(() => {
		if (mainCheckbox) {
			mainCheckbox.addEventListener("change", () => {});
			updateMainCheckbox(mainCheckbox);
		}
	});
</script>

<div class="feature-block">
	<vscode-checkbox class="feature-checkbox" bind:this={mainCheckbox}
	></vscode-checkbox>
	<vscode-collapsible class="collapsible-block" title={features[0].category}>
		{#each features as feature}
			<div class="checkbox-item">
				{#if selected.includes(feature.define)}
					<vscode-checkbox
						bind:this={checkbox[feature.define]}
						value={feature.define}
						disabled={disabledByDependency[feature.define]}
						checked>{feature.description}</vscode-checkbox
					>
				{:else}
					<vscode-checkbox
						bind:this={checkbox[feature.define]}
						value={feature.define}
						disabled={disabledByDependency[feature.define]}
						>{feature.description}</vscode-checkbox
					>
				{/if}
			</div>
		{/each}
	</vscode-collapsible>
</div>

<style>
	.feature-block {
		padding: 5px;
		width: 300px;
		background-color: var(--vscode-sideBar-background);
	}
	.feature-checkbox {
		display: inline-block;
		height: 100%;
		vertical-align: top;
	}
	.collapsible-block {
		display: inline-block;
		height: 100%;
		width: 75%;
		vertical-align: middle;
	}
	.checkbox-item {
		padding: 2px;
	}
</style>
