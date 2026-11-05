const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Initialize Supabase Server Client using environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.warn("WARNING: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in environment variables.");
}

const supabase = createClient(supabaseUrl || '', supabaseServiceKey || '');

// Secure endpoint to generate temporary 2-hour pre-signed streaming URL from Supabase Storage
app.post('/api/get-video-stream', async (req, res) => {
    try {
        const { userEmail, videoKey } = req.body;
        
        if (!userEmail || !videoKey) {
            return res.status(400).json({ error: 'Missing userEmail or videoKey parameters' });
        }

        // 1. Verify if user profile exists and has purchased the course
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('has_purchased')
            .eq('email', userEmail)
            .single();

        if (profileError || !profile || !profile.has_purchased) {
            return res.status(403).json({ error: 'Access denied. User has not purchased the course.' });
        }

        // 2. Generate a secure temporary signed URL from Supabase Storage bucket 'course-videos' valid for 2 hours (7200 seconds)
        const { data: signedData, error: signError } = await supabase
            .storage
            .from('course-videos')
            .createSignedUrl(videoKey, 7200);

        if (signError) {
            throw signError;
        }

        return res.json({ streamUrl: signedData.signedUrl });
    } catch (error) {
        console.error('Error generating secure stream URL:', error);
        return res.status(500).json({ error: 'Internal server error generating stream' });
    }
});

// Razorpay webhook endpoint to fulfill course access upon successful payment
app.post('/api/razorpay-webhook', async (req, res) => {
    try {
        const event = req.body;
        
        // Handle successful payment event from Razorpay
        if (event.event === 'payment.captured') {
            const paymentEntity = event.payload.payment.entity;
            const customerEmail = paymentEntity.email;
            const paymentId = paymentEntity.id;

            // Update user profile has_purchased flag in Supabase database
            const { error: updateError } = await supabase
                .from('profiles')
                .update({ 
                    has_purchased: true, 
                    razorpay_payment_id: paymentId 
                })
                .eq('email', customerEmail);

            if (updateError) {
                console.error('Failed to update profile purchase status:', updateError);
                return res.status(500).json({ error: 'Database update failed' });
            }
        }

        return res.status(200).json({ status: 'success' });
    } catch (err) {
        console.error('Webhook processing error:', err);
        return res.status(500).json({ error: 'Webhook handler failed' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Fx Masterclass server running locally on port ${PORT}`);
});