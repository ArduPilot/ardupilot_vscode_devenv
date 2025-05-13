<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  
  let { 
    showStack = true, 
    children,
    onerror, 
    onreset   
  } = $props<{
    showStack?: boolean;
    children: any;
    onerror?: (detail: { 
      error: Error | null; 
      originalStack: string; 
      enhancedStack?: string; 
      location?: string; 
    }) => void;
    onreset?: () => void;
  }>();
  
  let error: Error | null = $state(null);
  let originalStack = $state('');
  let enhancedStack = $state(''); // This will be updated by the custom event
  let originalError: any = null; // To store the original error object
  
  function handleError(event: ErrorEvent) {
    // This function will capture the initial error.
    // errorSourceMap.ts's window.onerror will also capture it, enhance it,
    // and then dispatch 'enhanced-error-event'.
    console.error("ErrorBoundary caught error:", event.error);
    originalError = event.error; // Store the original error object
    error = event.error || new Error(event.message);
    originalStack = error?.stack || error?.message || String(error);
    
    if (onerror) {
      onerror({ 
        error, // Pass the actual Error object
        originalStack,
        location: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined
        // enhancedStack will be added when the custom event arrives
      });
    }
    event.preventDefault(); // Prevent default browser error handling if you're fully handling it
  }
  
  function handleRejection(event: PromiseRejectionEvent) {
    console.error("ErrorBoundary caught rejection:", event.reason);
    originalError = event.reason; // Store the original error/reason
    error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    originalStack = error.stack || error.message || String(error);
    
    if (onerror) {
      onerror({ 
        error, // Pass the actual Error object
        originalStack
        // enhancedStack will be added when the custom event arrives
      });
    }
    event.preventDefault();
  }
  
  // Handler for the custom 'enhanced-error-event'
  function handleCustomEnhancedError(event: CustomEvent) {
    // event.detail contains the payload from errorSourceMap.ts
    if (event.detail && event.detail.error && event.detail.error.stack) {
      console.log("ErrorBoundary received custom enhanced error event:", event.detail.error);
      
      // Update the enhancedStack state. Svelte's reactivity will update the view.
      enhancedStack = event.detail.error.stack;
      
      // If an error was already captured, call the onerror prop again with the new enhancedStack.
      // The 'error' and 'originalStack' state variables should already be set from handleError/handleRejection.
      if (error && onerror) {
        onerror({
          error, // The original Error object from component's state
          originalStack, // The original stack from component's state
          enhancedStack // The newly received enhanced stack
          // location might have been set by handleError if it was an ErrorEvent
        });
      }
    }
  }
  
  onMount(() => {
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    // Listen for the custom event dispatched by errorSourceMap.ts
    window.addEventListener('enhanced-error-event', handleCustomEnhancedError as EventListener);
  });
  
  onDestroy(() => {
    window.removeEventListener('error', handleError);
    window.removeEventListener('unhandledrejection', handleRejection);
    window.removeEventListener('enhanced-error-event', handleCustomEnhancedError as EventListener);
  });
  
  function reset() {
    error = null;
    originalStack = '';
    enhancedStack = '';
    originalError = null;
    if (onreset) {
      onreset();
    }
  }
</script>

{#if error}
  <div class="error-boundary">
    <h2>Error Occurred</h2>
	<p class="error-message" style="white-space: pre-wrap;">{error.message}</p>
    
    {#if showStack}
      <details open>
        <summary>Original Stack Trace</summary>
        <pre class="stack-trace">{originalStack}</pre>
      </details>
      
      {#if enhancedStack}
        <details open>
          <summary>Enhanced Stack Trace</summary>
          <pre class="stack-trace enhanced">{enhancedStack}</pre>
        </details>
      {/if}
    {/if}
    
    <div class="error-actions">
      <button class="vscode-button" onclick={reset}>Dismiss Error</button>
    </div>
  </div>
{:else}
  {@render children()}
{/if}

<style>
  .error-boundary {
    padding: 16px;
    margin: 16px 0;
    border: 1px solid var(--vscode-errorForeground, #f14c4c);
    border-radius: 4px;
    background-color: var(--vscode-errorBackground, rgba(241, 76, 76, 0.1));
    color: var(--vscode-errorForeground, #f14c4c);
  }
  
  .error-message {
    font-weight: bold;
    margin-bottom: 12px;
  }
  
  .stack-trace {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    white-space: pre-wrap;
    overflow-x: auto;
    padding: 12px;
    background-color: var(--vscode-editor-background, #1e1e1e);
    border-radius: 3px;
    color: var(--vscode-editor-foreground, #d4d4d4);
  }
  
  /* Add styling for enhanced stack trace */
  .stack-trace.enhanced {
    border-left: 3px solid var(--vscode-focusBorder, #0e639c);
    /* background-color: var(--vscode-editor-background, #1e1e1e); // Already set by .stack-trace */
  }
  
  details {
    margin-bottom: 12px;
  }
  
  details summary {
    cursor: pointer;
    padding: 4px 0;
    font-weight: 500;
  }
  
  .error-actions {
    margin-top: 16px;
    display: flex;
    gap: 8px;
  }
</style>