const tick_slider = document.getElementById("tick-rate");
const tick_rate_value = document.getElementById("tick-rate-value");

tick_slider.addEventListener("input", () => {
	// The tick rate is calculated with logarithmic scale, and show the value with 5 digits
	const tick_rate = Math.round(Math.pow(2, (tick_slider.value - 1) / 127 * 15));
	tick_rate_value.textContent = tick_rate.toString().padStart(5, '0');
});