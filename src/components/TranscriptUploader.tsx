'use client';

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { parseMapPdf, DegreeProgress, CourseItem } from '../utils/transcriptParser';

export default function TranscriptUploader() {
    const [progress, setProgress] = useState<DegreeProgress | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [debug, setDebug] = useState<string>('');

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        setLoading(true);
        setError(null);
        setLogs([]);
        setProgress(null);
        setDebug('');

        try {
            const file = acceptedFiles[0];
            if (!file) return;

            setLogs(prev => [...prev, `Processing file: ${file.name}`]);

            const { degreeProgress: parsedData, debugText } = await parseMapPdf(file);

            if (!parsedData) {
                throw new Error("Parser returned no data");
            }

            setLogs(prev => [...prev, `Found ${parsedData.requirements.length} requirements tracked.`]);
            console.log('Parsed Data:', parsedData);

            if (parsedData.totalUnits === 0 && parsedData.requirements.length === 0) {
                setLogs(prev => [...prev, 'Warning: No data found.']);
                setDebug(debugText);
            }

            setProgress(parsedData);
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Failed to parse PDF');
            setLogs(prev => [...prev, `Error: ${err.message}`]);
        } finally {
            setLoading(false);
        }
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: { 'application/pdf': ['.pdf'] }
    });

    return (
        <div className="p-4 border rounded-lg shadow-sm bg-white dark:bg-gray-800 space-y-8">
            <div>
                <h2 className="text-xl font-semibold mb-4">Upload Transcript (PDF)</h2>

                <div
                    {...getRootProps()}
                    className={`border-2 border-dashed p-8 rounded-md text-center cursor-pointer transition-colors
          ${isDragActive ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-300 dark:border-gray-600'}
        `}
                >
                    <input {...getInputProps()} />
                    {
                        isDragActive ?
                            <p>Drop the PDF here...</p> :
                            <p>Drag & drop your MAP PDF here, or click to select files</p>
                    }
                </div>
            </div>

            {loading && <div className="text-gray-500">Parsing...</div>}
            {error && <div className="text-red-500">{error}</div>}

            <div className="bg-gray-50 dark:bg-gray-900 p-2 rounded text-xs max-h-32 overflow-y-auto font-mono">
                <div className="font-bold mb-1">Logs:</div>
                {logs.map((log, i) => <div key={i}>{log}</div>)}
            </div>

            {debug && (
                <div className="mt-4">
                    <h3 className="font-bold text-red-500">Debug Output (Raw Text Snippet):</h3>
                    <pre className="bg-gray-100 dark:bg-gray-900 p-2 text-xs overflow-auto h-48">
                        {debug}
                    </pre>
                </div>
            )}

            {progress && (
                <div className="space-y-8">
                    {/* Global State */}
                    <div className="bg-blue-50 dark:bg-blue-900/20 p-6 rounded-lg border border-blue-100 dark:border-blue-800">
                        <h3 className="text-2xl font-bold mb-2">{progress.studentName || 'Student'}</h3>
                        <div className="flex items-center gap-4 mb-4">
                            <div className="flex-1">
                                <div className="flex justify-between text-sm mb-1">
                                    <span>Total Units Completed</span>
                                    <span className="font-bold">{progress.totalUnits} / {progress.totalUnitsNeeded}</span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                                    <div className="bg-blue-600 h-2.5 rounded-full" style={{ width: `${Math.min(100, (progress.totalUnits / progress.totalUnitsNeeded) * 100)}%` }}></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Requirements List */}
                    <div className="space-y-4">
                        <h3 className="text-xl font-bold">Degree Requirements</h3>
                        {progress.requirements.map((req, i) => (
                            <div key={i} className={`border rounded-lg p-4 ${req.satisfied ? 'bg-green-50/50 border-green-200' : 'bg-white border-gray-200'}`}>
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className={`text-lg ${req.satisfied ? 'text-green-600' : 'text-gray-400'}`}>
                                            {req.satisfied ? '✔' : '○'}
                                        </span>
                                        <h4 className="font-bold text-lg">{req.name}</h4>
                                    </div>
                                    {!req.satisfied && (
                                        <div className="text-sm text-red-600 bg-red-50 px-2 py-1 rounded">
                                            {req.missingUnits ? `${req.missingUnits} Units Needed` :
                                                req.missingCourses ? `${req.missingCourses} Class(es) Needed` : 'Incomplete'}
                                        </div>
                                    )}
                                </div>

                                {req.courses.length > 0 ? (
                                    <div className="pl-6">
                                        <CourseTable courses={req.courses} />
                                    </div>
                                ) : (
                                    <div className="pl-6 text-sm text-gray-400 italic">No courses applied yet.</div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Unused Electives */}
                    {progress.unusedElectives.length > 0 && (
                        <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-900/30">
                            <h3 className="text-lg font-bold mb-2 text-gray-700 dark:text-gray-300">Unused Electives / General</h3>
                            <CourseTable courses={progress.unusedElectives} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function CourseTable({ courses }: { courses: CourseItem[] }) {
    return (
        <div className="overflow-x-auto mt-2">
            <table className="min-w-full text-sm">
                <thead>
                    <tr className="text-gray-500 border-b">
                        <th className="text-left font-medium p-2">Code</th>
                        <th className="text-left font-medium p-2">Title</th>
                        <th className="text-left font-medium p-2">Units</th>
                        <th className="text-left font-medium p-2">Grade</th>
                        <th className="text-left font-medium p-2">Term</th>
                    </tr>
                </thead>
                <tbody>
                    {courses.map((c, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            <td className="p-2 font-medium">{c.code}</td>
                            <td className="p-2 text-gray-600">{c.title}</td>
                            <td className="p-2">{c.units}</td>
                            <td className="p-2">{c.grade}</td>
                            <td className="p-2 whitespace-nowrap text-gray-500">{c.term}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
