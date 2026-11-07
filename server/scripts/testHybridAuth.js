const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function testHybridFlow() {
  console.log('Testing Hybrid Authentication System...\n');

  const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('❌ MONGO_URI is missing from environment.');
    process.exit(1);
  }

  await mongoose.connect(mongoURI);
  const User = require('../models/User');

  const testEmail = `hybrid_test_${Date.now()}@example.com`;

  try {
    // Step 1: Create pure Google user (password: null)
    const googleUser = await User.create({
      name: 'Hybrid Test User',
      email: testEmail,
      googleId: 'google_oauth_12345',
      authProvider: 'google',
      isVerified: true,
      password: null,
    });
    console.log('✅ Step 1: Created pure Google account with password: null.');

    // Step 2: Attempt password check - must detect Google account without crashing
    const foundUser = await User.findOne({ email: testEmail });
    if (!foundUser.password && foundUser.googleId) {
      console.log('✅ Step 2: Correctly identified account as Google-linked without a password.');
    } else {
      throw new Error('Failed to detect Google account state.');
    }

    // Step 3: Set password (simulating reset/set password flow)
    const salt = await bcrypt.genSalt(10);
    foundUser.password = await bcrypt.hash('Sanu@123', salt);
    foundUser.authProvider = 'hybrid';
    await foundUser.save();
    console.log('✅ Step 3: Added password to Google account. Account promoted to "hybrid".');

    // Step 4: Verify password login succeeds
    const verifiedUser = await User.findOne({ email: testEmail });
    const isMatch = await bcrypt.compare('Sanu@123', verifiedUser.password);
    if (isMatch && verifiedUser.authProvider === 'hybrid') {
      console.log('✅ Step 4: Password authentication succeeded for hybrid account.');
    } else {
      throw new Error('Password match failed on hybrid account.');
    }

    // Clean up
    await User.deleteOne({ _id: googleUser._id });
    console.log('\nAll Hybrid Authentication Tests Passed Cleanly.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Hybrid Auth Test Failed:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

testHybridFlow();

