const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Define all batches (50 items each, except last one)
const batches = [
  [100, 150],  // Batch 3
  [150, 200],  // Batch 4
  [200, 250],  // Batch 5
  [250, 300],  // Batch 6
  [300, 350],  // Batch 7
  [350, 400],  // Batch 8
  [400, 450],  // Batch 9
  [450, 500],  // Batch 10
  [500, 550],  // Batch 11
  [550, 600],  // Batch 12
  [600, 650],  // Batch 13
  [650, 700],  // Batch 14
  [700, 720],  // Batch 15
];

async function runBatch(batchNum, start, end) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Starting Batch ${batchNum}/15: Items ${start}-${end}`);
  console.log(`${'='.repeat(60)}\n`);
  
  const startTime = Date.now();
  
  try {
    const { stdout, stderr } = await execPromise(`node scrapers\\scrape-sonny-angel-batch.js ${start} ${end}`);
    
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(2);
    console.log(`\n✅ Batch ${batchNum}/15 completed in ${duration} minutes`);
    
    return true;
  } catch (error) {
    console.error(`\n❌ Batch ${batchNum}/15 failed:`, error.message);
    return false;
  }
}

async function runAllBatches() {
  console.log('🚀 Starting automated Sonny Angel price scraping');
  console.log(`📊 Total: 13 batches (620 items)`);
  console.log(`⏱️  Estimated time: 2-3 hours\n`);
  
  const overallStart = Date.now();
  let successCount = 0;
  let failCount = 0;
  
  for (let i = 0; i < batches.length; i++) {
    const [start, end] = batches[i];
    const batchNum = i + 3; // Start from batch 3
    
    const success = await runBatch(batchNum, start, end);
    
    if (success) {
      successCount++;
    } else {
      failCount++;
      console.log('\n⚠️  Batch failed, but continuing with next batch...\n');
    }
    
    // Small delay between batches to avoid detection
    if (i < batches.length - 1) {
      console.log('\n⏳ Waiting 30 seconds before next batch...\n');
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
  
  const totalDuration = ((Date.now() - overallStart) / 1000 / 60).toFixed(2);
  
  console.log('\n' + '='.repeat(60));
  console.log('🎉 ALL BATCHES COMPLETED!');
  console.log('='.repeat(60));
  console.log(`✅ Successful: ${successCount}/13 batches`);
  console.log(`❌ Failed: ${failCount}/13 batches`);
  console.log(`⏱️  Total time: ${totalDuration} minutes`);
  console.log(`📁 Data saved to: data/sonny-angel-mercari-prices.json`);
  console.log('='.repeat(60) + '\n');
}

runAllBatches().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
