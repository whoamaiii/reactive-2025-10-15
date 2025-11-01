/**
 * Vite Build Configuration
 * 
 * This file configures how the application is built and served during development.
 * Vite is a build tool that compiles our code and runs a development server.
 * 
 * Think of this like a recipe card that tells the build system:
 * - Where to serve the app (port 5173)
 * - How to compile the code (target modern browsers)
 * - Which libraries to skip bundling (ones we load from the internet instead)
 */

import { defineConfig } from 'vite';

export default defineConfig({
  // Development server settings
  // When you run "npm run dev", this tells Vite how to start the server
  server: {
    port: 5173, // The port number where the app will be available (http://localhost:5173)
    open: false, // Don't automatically open the browser when starting the server
  },
  
  // Production build settings
  // When you run "npm run build", these settings control how the code is packaged
  build: {
    target: 'es2020', // Compile to JavaScript that works in browsers from 2020 onwards
    rollupOptions: {
      // Externalize optional modules that are lazy-loaded via CDN when present
      // These are libraries we might load from the internet instead of bundling them in
      // This keeps the initial download smaller - we only load these if we need them
      external: ['essentia.js', 'ml5', 'butterchurn', 'wavesurfer.js']
    }
  },
});


