import { defineConfig,devices } from "@playwright/test";
export default defineConfig({testDir:"./tests/tutor-browser",fullyParallel:false,workers:1,retries:0,timeout:30000,use:{trace:"retain-on-failure"},projects:[{name:"desktop-chromium",use:{...devices["Desktop Chrome"]}},{name:"mobile-chromium",use:{...devices["Pixel 7"],viewport:{width:360,height:800}}}]});
