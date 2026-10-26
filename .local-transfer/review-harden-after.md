Before you let it run alone, tighten it. **Hardening** makes the skill check its own work and fail loudly instead of quietly, so you can trust the output without re-reading every line. 

An unhardened skill does not break. It hands you something slightly wrong and says nothing. 

> [!TIP]
> Your rules are already in the file, so hardening is really just **a check that holds every draft to them** before it reaches you.

## Slides

![Slide 1: the quiet failure](http://127.0.0.1:8797/sites/ai-employee-builders/media/canvases/v7-harden/01-the-quiet-failure.png)

Two ways this week’s email can go wrong. On the left it breaks loudly. The AI tells you it could not open your stats file, you see it straight away, and nothing goes out. Look at the right-hand one instead. It reads perfectly and has **one number in it that was never in your stats**. That is the one that reaches your list with your name on it.

![Slide 2: your rules are in your head](http://127.0.0.1:8797/sites/ai-employee-builders/media/canvases/v7-harden/02-your-rules-are-in-your-head.png)

Your rules are already in the file. Three came from your interview and one from a correction you made. Now look at the section underneath, the self-check before handing it over. **It is empty.** So the AI writes the draft and hands it straight to you, 34% and all, because nothing in the file tells it to check.

![Slide 3: written into the file](http://127.0.0.1:8797/sites/ai-employee-builders/media/canvases/v7-harden/03-written-into-the-file.png)

Same file, and that empty section is now filled in. Before it hands you anything, it reads the draft against every rule, and if one breaks it stops and tells you which. That is most of what **hardening** means. You already had the rules. Now there is **a check between writing the draft and handing it over**.

![Slide 4: it stops itself](http://127.0.0.1:8797/sites/ai-employee-builders/media/canvases/v7-harden/04-it-stops-itself.png)

The 34% draft from the first slide, run again with the self-check in place. The AI reads what it just wrote against the rule, only use numbers from the stats, and it stops. It points at line 2 and names the rule it broke. **Nothing reached you**, and nothing else was involved. It read its own file and checked its own draft.

![Slide 5: a fix that stays fixed](http://127.0.0.1:8797/sites/ai-employee-builders/media/canvases/v7-harden/05-a-fix-that-stays-fixed.png)

One more piece keeps the fix fixed. **The scorecard** is five test inputs where you already know the right answer, and the AI runs all five itself after every edit to the skill. Four pass. Test 5 is the interesting one, because Tuesday’s edit broke the number rule and it wrote 34% again. **The scorecard stopped it before anything went out.**
