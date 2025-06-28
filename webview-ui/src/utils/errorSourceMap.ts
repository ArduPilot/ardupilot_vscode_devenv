import { SourceMapConsumer, type RawSourceMap } from 'source-map';

// Extend the SourceMapConsumer type to include the initialize method
declare module 'source-map' {
  interface SourceMapConsumerConstructor {
    initialize(opts: { [key: string]: ArrayBuffer }): Promise<void>;
  }
}

// Store source map data once loaded
let sourceMapData: RawSourceMap | null = null;
let sourceMapConsumer: SourceMapConsumer | null = null;
let sourceMapInitialized = false;

// Function to transform error stack traces to include original TypeScript sources
export function installErrorHandler() {
  const originalHandler = window.onerror;

  // Initialize SourceMapConsumer with WASM module first
  initializeSourceMap().then(() => {
    // Then load source map from URL
    return loadSourceMap();
  }).then(() => {
    console.log('Source map loaded successfully');
  }).catch(err => {
    console.error('Failed to load source map:', err);
  });

  window.onerror = async function(msg, source, line, column, error) {
    if (error && error.stack) {
      try {
        // Process the stack trace to replace compiled JS references with TypeScript ones
        const enhancedStack = await enhanceStackTrace(error.stack);
        // console.error('Original Error:', error.message); // Logged by ErrorBoundary
        // console.error('Source Mapped Stack:', enhancedStack); // Logged by ErrorBoundary

        // Dispatch a custom event for ErrorBoundary within the same webview
        const customEvent = new CustomEvent('enhanced-error-event', {
          detail: {
            error: { 
              stack: enhancedStack
            }
          }
        });
        window.dispatchEvent(customEvent);
        
      } catch (e) {
        console.error('Error enhancing stack trace:', e);
      }
    }
    
    // Call the original handler if it exists
    if (originalHandler) {
      return originalHandler.call(this, msg, source, line, column, error);
    }
    
    // Return false to allow the default browser error handling
    return false;
  };
  
  // Also handle unhandled promise rejections
  window.addEventListener('unhandledrejection', async function(event) {
    if (event.reason) {
      try {
        const reasonError = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
        const enhancedStack = await enhanceStackTrace(reasonError.stack || '');
        // console.error('Unhandled Rejection:', reasonError.message);
        // console.error('Source Mapped Stack for Rejection:', enhancedStack);

        // Dispatch a custom event for ErrorBoundary
        const customEvent = new CustomEvent('enhanced-error-event', {
          detail: {
            error: {
              stack: enhancedStack
            }
          }
        });
        window.dispatchEvent(customEvent);

      } catch (e) {
        console.error('Error enhancing rejection stack:', e);
      }
    }
  });
}

// Function to initialize the source-map WASM module
async function initializeSourceMap() {
  if (sourceMapInitialized) {
    return;
  }
  
  try {
    // Get the path to the wasm file which should be included in your bundled output
    // or available via CDN
    const wasmUrl = 'https://unpkg.com/source-map@0.7.4/lib/mappings.wasm';
    
    // Fetch the WASM binary
    const response = await fetch(wasmUrl);
    const wasmBuffer = await response.arrayBuffer();
    
    // Initialize SourceMapConsumer with the WASM binary
    await SourceMapConsumer.initialize({
      'lib/mappings.wasm': wasmBuffer
    });
    
    sourceMapInitialized = true;
    console.log('SourceMapConsumer initialized with WASM');
  } catch (err) {
    console.error('Failed to initialize SourceMapConsumer:', err);
    throw err; // Re-throw to be caught by the promise chain in installErrorHandler
  }
}

// Function to load source map once at startup
async function loadSourceMap() {
  // Make sure SourceMapConsumer is initialized first
  if (!sourceMapInitialized) {
    // This should ideally not happen if initializeSourceMap is called first and awaited
    console.warn('Attempting to load source map before WASM initialized. Trying to initialize now.');
    await initializeSourceMap(); 
  }
  
  // Check if we have a source map URL from the webview
  if (window.SOURCE_MAP_URL) {
    try {
      console.log('Loading source map from URL:', window.SOURCE_MAP_URL);
      const response = await fetch(window.SOURCE_MAP_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch source map: ${response.status} ${response.statusText}`);
      }
      sourceMapData = await response.json() as RawSourceMap;
      
      // Initialize the source map consumer
      sourceMapConsumer = await new SourceMapConsumer(sourceMapData);
      return sourceMapConsumer;
    } catch (err) {
      console.error('Error loading source map:', err);
      throw err; // Re-throw to be caught by the promise chain in installErrorHandler
    }
  } else {
    console.warn('No source map URL provided by webview');
    throw new Error('No source map URL provided');
  }
}

// Function to enhance a stack trace with source map data
async function enhanceStackTrace(stack: string): Promise<string> {
  if (!stack) return stack;
  
  // Ensure source map is loaded and consumer is available
  if (sourceMapConsumer === null) {
    try {
      // Attempt to load it if not already loaded.
      // This is a fallback, ideally it's loaded during installErrorHandler.
      console.warn('SourceMapConsumer not available when enhancing stack. Attempting to load now.');
      await loadSourceMap(); 
    } catch (err) {
      console.warn('Could not load source map for stack trace enhancement:', err);
      return stack; // Return original stack if we can't load the source map
    }
  }
  // Double check after attempting to load
  if (sourceMapConsumer === null) {
    console.warn('SourceMapConsumer still not available after attempting to load. Returning original stack.');
    return stack;
  }
  
  const lines = stack.split('\n');
  const mappedLines = lines.map(line => {
    const match = line.match(/at\s+(.+?)\s+\(?(.+?)(?::(\d+):(\d+))?\)?$/);
    if (!match) return line;
    
    const [, fnName, sourcePath, lineStr, columnStr] = match;
    if (!lineStr || !columnStr || !sourcePath.includes('index.js')) return line;
    
    const lineNum = parseInt(lineStr, 10);
    const columnNum = parseInt(columnStr, 10);
    
    try {
      const originalPos = sourceMapConsumer!.originalPositionFor({
        line: lineNum,
        column: columnNum,
        bias: SourceMapConsumer.GREATEST_LOWER_BOUND // Or LEAST_UPPER_BOUND depending on preference
      });
      
      if (originalPos.source && originalPos.line != null) { // originalPos.line can be 0
        return `    at ${fnName || originalPos.name || '(anonymous)'} (${originalPos.source}:${originalPos.line}:${originalPos.column || 0})`;
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // console.error('Error mapping stack trace line:', e); // Can be noisy
    }
    
    return line;
  });
  
  return mappedLines.join('\n');
}

// Add to global window type
declare global {
  interface Window {
    SOURCE_MAP_URL: string;
  }
}