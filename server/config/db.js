const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 20, // Prevents exhausting M0 connection ceiling
      minPoolSize: 5,  // Keeps 5 hot connections open for 0ms query latency
      serverSelectionTimeoutMS: 5000,
    });
    console.log('MongoDB Atlas Connected with optimized connection pool');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

module.exports = connectDB;

