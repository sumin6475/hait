import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { UserCircle } from "lucide-react";

const Demographics = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ age: "", gender: "", major: "" });

  const isValid = form.age && form.gender && form.major;

  const handleSubmit = () => {
    if (isValid) {
      sessionStorage.setItem("demographics", JSON.stringify(form));
      navigate("/chat/info-cards");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md bg-card rounded-xl border p-8 space-y-6">
        <div className="flex items-center gap-3">
          <UserCircle className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-semibold">Background Survey</h1>
        </div>
        <p className="text-sm text-muted-foreground">Please provide some basic information about yourself.</p>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Age</label>
            <input
              type="number"
              value={form.age}
              onChange={(e) => setForm({ ...form, age: e.target.value })}
              placeholder="e.g. 22"
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Gender</label>
            <select
              value={form.gender}
              onChange={(e) => setForm({ ...form, gender: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select...</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="non-binary">Non-binary</option>
              <option value="prefer-not">Prefer not to say</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Major / Field of Study</label>
            <input
              type="text"
              value={form.major}
              onChange={(e) => setForm({ ...form, major: e.target.value })}
              placeholder="e.g. Psychology"
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <Button onClick={handleSubmit} className="w-full" size="lg" disabled={!isValid}>
          Continue
        </Button>
      </div>
    </div>
  );
};

export default Demographics;
