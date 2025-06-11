import React from 'react';
import { LoaderCircle } from 'lucide-react';

const LoadingIndicator = () => {
    return (
        <div className="animate-spin rounded-full h-10 w-10 flex items-center justify-center text-blue-500">
            <LoaderCircle size={40} />
        </div>
    );
};

export default LoadingIndicator;
