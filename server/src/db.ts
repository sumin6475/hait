import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectDB() : Promise<void> {
    try{
        await mongoose.connect(config.mongodbUri);
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        throw error;
    }
}

