import { useEffect, useState, useCallback } from 'react';

type Position = {
    x: number;
    y: number;
};

type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

const ALL_TIME_BEST_STORAGE_KEY = 'allTimeBest';

export function SnakeGame() {
    const GRID_SIZE = 6;
    const CELL_SIZE = 24;
    const GAME_SPEED = 250;

    const [snake, setSnake] = useState<Position[]>([{ x: 2, y: 2 }]);
    const [food, setFood] = useState<Position>({ x: 4, y: 4 });
    const [direction, setDirection] = useState<Direction>('RIGHT');
    const [score, setScore] = useState(0);

    const allTimeBest = Number(localStorage.getItem(ALL_TIME_BEST_STORAGE_KEY) || 0);
    const [bestScore, setBestScore] = useState(allTimeBest);

    const generateFood = useCallback(() => {
        const newFood = {
            x: Math.floor(Math.random() * GRID_SIZE),
            y: Math.floor(Math.random() * GRID_SIZE),
        };
        // Avoid placing food on snake
        if (snake.some(segment => segment.x === newFood.x && segment.y === newFood.y)) {
            generateFood();
            return;
        }
        setFood(newFood);
    }, [snake]);

    const reset = useCallback(() => {
        setSnake([{ x: 2, y: 2 }]);
        setDirection('RIGHT');
        setScore(0);
        generateFood();

        // Check if the current score is greater than the best score
        if (score > bestScore) {
            setBestScore(score);
            localStorage.setItem(ALL_TIME_BEST_STORAGE_KEY, score.toString());
        }
    }, [score, bestScore, generateFood]);

    const moveSnake = useCallback(() => {
        setSnake(currentSnake => {
            const head = currentSnake[0];
            const newHead = { ...head };

            switch (direction) {
                case 'UP':
                    newHead.y = (newHead.y - 1 + GRID_SIZE) % GRID_SIZE;
                    break;
                case 'DOWN':
                    newHead.y = (newHead.y + 1) % GRID_SIZE;
                    break;
                case 'LEFT':
                    newHead.x = (newHead.x - 1 + GRID_SIZE) % GRID_SIZE;
                    break;
                case 'RIGHT':
                    newHead.x = (newHead.x + 1) % GRID_SIZE;
                    break;
            }

            // Check if snake ate food
            if (newHead.x === food.x && newHead.y === food.y) {
                generateFood();
                setScore(s => s + 1);
                return [newHead, ...currentSnake];
            }

            // Check for collision with itself
            if (currentSnake.some(segment => segment.x === newHead.x && segment.y === newHead.y)) {
                reset();
                return [];
            }

            return [newHead, ...currentSnake.slice(0, -1)];
        });
    }, [direction, food.x, food.y, generateFood, GRID_SIZE]);

    useEffect(() => {
        const handleKeyPress = (e: KeyboardEvent) => {
            e.preventDefault(); // Prevent page scrolling

            const newDirection: { [key: string]: Direction } = {
                ArrowUp: 'UP',
                ArrowDown: 'DOWN',
                ArrowLeft: 'LEFT',
                ArrowRight: 'RIGHT'
            };

            if (newDirection[e.key]) {
                setDirection(newDirection[e.key]);
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        const gameInterval = setInterval(moveSnake, GAME_SPEED);

        return () => {
            window.removeEventListener('keydown', handleKeyPress);
            clearInterval(gameInterval);
        };
    }, [moveSnake]);

    return (
        <div className="flex flex-col items-center gap-4">
            <div className="text-lg font-bold">Score: {score}</div>
            {
                bestScore > 0 && (
                    <div className="text-sm text-muted-foreground">
                        All Time Best: {bestScore}
                    </div>
                )
            }
            <div
                className="grid bg-gray-100 rounded-lg p-2"
                style={{
                    gridTemplateColumns: `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`,
                    gap: '1px',
                    width: `${GRID_SIZE * (CELL_SIZE + 3)}px`,
                    height: `${GRID_SIZE * (CELL_SIZE + 3)}px`
                }}
            >
                {Array.from({ length: GRID_SIZE * GRID_SIZE }).map((_, index) => {
                    const x = index % GRID_SIZE;
                    const y = Math.floor(index / GRID_SIZE);
                    const isSnake = snake.some(segment => segment.x === x && segment.y === y);
                    const isFood = food.x === x && food.y === y;

                    return (
                        <div
                            key={index}
                            style={{
                                width: CELL_SIZE,
                                height: CELL_SIZE
                            }}
                            className={`
                                ${isSnake ? 'bg-primary' : ''}
                                ${isFood ? 'bg-green-500' : ''}
                                ${!isSnake && !isFood ? 'bg-white' : ''}
                            `}
                        />
                    );
                })}
            </div>
            <p className="text-sm text-muted-foreground">
                Use arrow keys to move
            </p>
        </div>
    );
}
