<script lang="ts">
	import "@vscode-elements/elements/dist/vscode-textfield/index.js";
	import "@vscode-elements/elements/dist/vscode-label/index.js";

	let { value = $bindable(), vscodeHooks, ...props } = $props();

	let textField: any = $state(null);
	let options = $state<{ name: string; description: string }[]>([]);
	let filteredOptions = $state<{ name: string; description: string }[]>([]);
	let showSuggestions = $state(false);
	let selectedIndex = $state(-1);
	let currentWord = $state("");
	let wordStartIndex = $state(0);

	$effect(() => {
		loadConfigureOptions();
	});

	$effect(() => {
		if (textField) {
			// Set up event listeners for vscode-textfield
			textField.addEventListener("input", handleInput);
			textField.addEventListener("change", handleInput);
			textField.addEventListener("keyup", handleInput);
			textField.addEventListener("keydown", handleKeyDown);
			textField.addEventListener("blur", handleBlur);
			textField.addEventListener("focus", handleFocus);
			
			// Also listen on the internal input element
			const internalInput = textField.querySelector('input');
			if (internalInput) {
				internalInput.addEventListener("input", handleInput);
				internalInput.addEventListener("keyup", handleInput);
			}
		}
	});

	// Update the textfield value when the prop value changes
	$effect(() => {
		if (textField && value !== undefined) {
			textField.value = value;
		}
	});

	async function loadConfigureOptions() {
		if (!vscodeHooks) return;
		
		try {
			const response = await vscodeHooks.request("getConfigureOptions");
			options = response.options || [];
		} catch (error) {
			console.error("Failed to load configure options:", error);
			options = [];
		}
	}

	function handleInput(event: Event) {
		const input = event.target as any;
		const inputValue = input.value || input.currentValue || textField?.value || '';
		value = inputValue;
		
		// Find the current word being typed
		// For vscode-textfield, try to get cursor position from internal input
		let cursorPos = inputValue.length;
		const internalInput = textField?.querySelector('input');
		if (internalInput && typeof internalInput.selectionStart === 'number') {
			cursorPos = internalInput.selectionStart;
		} else if (input.selectionStart !== undefined) {
			cursorPos = input.selectionStart;
		}
		
		const text = inputValue;
		
		// Find word boundaries
		let start = cursorPos;
		while (start > 0 && !/\s/.test(text[start - 1])) {
			start--;
		}
		
		wordStartIndex = start;
		currentWord = text.substring(start, cursorPos);
		
		// Filter options based on current word
		if (currentWord.length > 0) {
			const filtered = options.filter(opt => 
				opt.name.toLowerCase().startsWith(currentWord.toLowerCase())
			);
			
			// Sort to show single character options first, then long options
			filteredOptions = filtered.sort((a, b) => {
				const aIsSingle = a.name.match(/^-[a-zA-Z]$/);
				const bIsSingle = b.name.match(/^-[a-zA-Z]$/);
				
				// Single character options come first
				if (aIsSingle && !bIsSingle) return -1;
				if (!aIsSingle && bIsSingle) return 1;
				
				// Within the same type, sort alphabetically
				return a.name.localeCompare(b.name);
			});
			
			showSuggestions = filteredOptions.length > 0;
			selectedIndex = -1;
		} else {
			showSuggestions = false;
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (!showSuggestions) return;
		
		switch (event.key) {
			case 'Tab':
				event.preventDefault();
				if (filteredOptions.length > 0) {
					const index = selectedIndex >= 0 ? selectedIndex : 0;
					selectOption(filteredOptions[index]);
				}
				break;
				
			case 'ArrowDown':
				event.preventDefault();
				selectedIndex = Math.min(selectedIndex + 1, filteredOptions.length - 1);
				break;
				
			case 'ArrowUp':
				event.preventDefault();
				selectedIndex = Math.max(selectedIndex - 1, -1);
				break;
				
			case 'Enter':
				if (selectedIndex >= 0) {
					event.preventDefault();
					selectOption(filteredOptions[selectedIndex]);
				}
				break;
				
			case 'Escape':
				event.preventDefault();
				showSuggestions = false;
				break;
		}
	}

	function handleBlur() {
		// Delay hiding suggestions to allow for click events
		setTimeout(() => {
			showSuggestions = false;
		}, 200);
	}

	function handleFocus() {
		if (currentWord.length > 0 && filteredOptions.length > 0) {
			showSuggestions = true;
		}
	}

	function selectOption(option: { name: string; description: string }) {
		if (!textField) return;
		
		const currentValue = textField.value || '';
		
		// Replace current word with selected option
		const before = currentValue.substring(0, wordStartIndex);
		const after = currentValue.substring(wordStartIndex + currentWord.length);
		
		// Add a space after the option if there isn't one
		const spacing = after.startsWith(' ') ? '' : ' ';
		
		const newValue = before + option.name + spacing + after;
		textField.value = newValue;
		value = newValue;
		
		// Try to set cursor position on the internal input element
		const internalInput = textField.querySelector('input');
		if (internalInput) {
			const newPos = wordStartIndex + option.name.length + spacing.length;
			setTimeout(() => {
				internalInput.setSelectionRange(newPos, newPos);
				internalInput.focus();
			}, 0);
		}
		
		showSuggestions = false;
	}

	function handleOptionClick(option: { name: string; description: string }) {
		selectOption(option);
	}
</script>

<vscode-label for={props.id}>{props.label}</vscode-label>
<div class="autocomplete-container">
	<vscode-textfield bind:this={textField} id={props.id} type="text"></vscode-textfield>
	
	<div class="help-text">
		<small>
			💡 Start typing a configure option (e.g., <code>--debug</code> or <code>-g</code>) for autocomplete suggestions. 
			Use <kbd>Tab</kbd> to complete, <kbd>↑↓</kbd> to navigate, <kbd>Enter</kbd> to select.
		</small>
	</div>
	
	{#if showSuggestions && filteredOptions.length > 0}
		<div class="suggestions-dropdown">
			{#each filteredOptions as option, index}
				<div 
					class="suggestion-item"
					class:selected={index === selectedIndex}
					role="button"
					tabindex="-1"
					onclick={() => handleOptionClick(option)}
					onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOptionClick(option); } }}
					onmouseenter={() => selectedIndex = index}
				>
					<span class="option-name">{option.name}</span>
					{#if option.description}
						<span class="option-description">{option.description}</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.autocomplete-container {
		position: relative;
		width: 100%;
	}

	.suggestions-dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		max-height: 200px;
		overflow-y: auto;
		background-color: var(--vscode-dropdown-background);
		border: 1px solid var(--vscode-dropdown-border);
		border-radius: 3px;
		margin-top: 2px;
		z-index: 1000;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.16);
	}

	.suggestion-item {
		padding: 8px 12px;
		cursor: pointer;
		border-bottom: 1px solid var(--vscode-widget-border);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.suggestion-item:last-child {
		border-bottom: none;
	}

	.suggestion-item:hover,
	.suggestion-item.selected {
		background-color: var(--vscode-list-hoverBackground);
	}

	.option-name {
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
		color: var(--vscode-foreground);
		font-weight: 500;
	}

	.option-description {
		font-size: 0.9em;
		color: var(--vscode-descriptionForeground);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Scrollbar styling */
	.suggestions-dropdown::-webkit-scrollbar {
		width: 10px;
	}
	
	.suggestions-dropdown::-webkit-scrollbar-track {
		background: transparent;
	}
	
	.suggestions-dropdown::-webkit-scrollbar-thumb {
		background: var(--vscode-scrollbarSlider-background);
		border-radius: 4px;
		border: 2px solid transparent;
		background-clip: padding-box;
	}
	
	.suggestions-dropdown::-webkit-scrollbar-thumb:hover {
		background: var(--vscode-scrollbarSlider-hoverBackground);
	}

	/* Help text styling */
	.help-text {
		margin-top: 4px;
		padding: 4px 0;
		color: var(--vscode-descriptionForeground);
		font-size: 0.85em;
		line-height: 1.3;
	}

	.help-text code {
		background: var(--vscode-textCodeBlock-background);
		color: var(--vscode-textPreformat-foreground);
		padding: 1px 3px;
		border-radius: 2px;
		font-family: var(--vscode-editor-font-family);
		font-size: 0.9em;
	}

	.help-text kbd {
		background: var(--vscode-keybindingLabel-background);
		color: var(--vscode-keybindingLabel-foreground);
		border: 1px solid var(--vscode-keybindingLabel-border);
		border-radius: 3px;
		padding: 1px 4px;
		font-family: var(--vscode-editor-font-family);
		font-size: 0.85em;
		box-shadow: 0 1px 1px rgba(0, 0, 0, 0.1);
	}
</style>