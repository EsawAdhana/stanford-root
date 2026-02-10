'use client';

import TranscriptUploader from '@/components/TranscriptUploader';

export default function TranscriptTestPage() {
    return (
        <div className="container mx-auto py-10">
            <h1 className="text-3xl font-bold mb-6">Transcript Parser Test</h1>
            <div className="max-w-2xl mx-auto">
                <TranscriptUploader />
            </div>
        </div>
    );
}
