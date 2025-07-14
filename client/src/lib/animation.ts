export function smoothScrollTo(
    targetElement: HTMLElement,
    scrollContainer: HTMLElement,
    duration: number = 600
) {
    const targetPosition = targetElement.offsetTop - scrollContainer.offsetTop;
    const startPosition = scrollContainer.scrollTop;
    const distance = targetPosition - startPosition;
    let startTime: number | null = null;

    const ease = (t: number, b: number, c: number, d: number): number => {
        t /= d / 2;
        if (t < 1) return (c / 2) * t * t + b;
        t--;
        return (-c / 2) * (t * (t - 2) - 1) + b;
    };

    const animation = (currentTime: number) => {
        if (startTime === null) {
            startTime = currentTime;
        }
        const timeElapsed = currentTime - startTime;
        const run = ease(timeElapsed, startPosition, distance, duration);
        scrollContainer.scrollTop = run;
        if (timeElapsed < duration) {
            requestAnimationFrame(animation);
        }
    };

    requestAnimationFrame(animation);
}
